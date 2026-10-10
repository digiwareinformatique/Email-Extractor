<?php
/**
 * Link tracker, URL generator and redirection handler for WhatsApp messages
 *
 * @package DigiWare\WhatsApp\Tracking
 */

namespace DigiWare\WhatsApp\Tracking;

if (!defined('ABSPATH')) {
    exit;
}

class LinkTracker {

    /**
     * Initialize redirection listener
     */
    public static function init() {
        add_action('init', array(__CLASS__, 'handle_redirection'), 5);
    }

    /**
     * Generate tracked target URL with OmniTracker and UTM tags
     *
     * @param string $target_url Base destination URL
     * @param string $campaign_slug Campaign slug
     * @param string $job_token Unique token for this recipient message job
     * @param array $extra_utm Optional extra UTM parameters
     * @return string
     */
    public static function build_tracked_url($target_url, $campaign_slug, $job_token, array $extra_utm = array()) {
        if (empty($target_url)) {
            $target_url = home_url('/');
        }

        $params = array(
            'utm_source'   => 'whatsapp',
            'utm_medium'   => isset($extra_utm['utm_medium']) ? $extra_utm['utm_medium'] : 'direct_message',
            'utm_campaign' => $campaign_slug,
            'utm_content'  => $job_token,
            'ot_src'       => 'whatsapp',
            'ot_camp'      => $campaign_slug,
            'ot_job'       => $job_token,
        );

        if (!empty($extra_utm['utm_term'])) {
            $params['utm_term'] = $extra_utm['utm_term'];
        }

        return add_query_arg($params, $target_url);
    }

    /**
     * Build the short redirect URL for WhatsApp messages
     *
     * @param string $job_token
     * @return string
     */
    public static function build_redirect_url($job_token) {
        return add_query_arg(array('dw_wa_redir' => $job_token), home_url('/'));
    }

    /**
     * Intercept and handle incoming WhatsApp link clicks
     */
    public static function handle_redirection() {
        if (!isset($_GET['dw_wa_redir'])) {
            return;
        }

        $token = sanitize_text_field($_GET['dw_wa_redir']);
        if (empty($token)) {
            return;
        }

        global $wpdb;
        $jobs_table = $wpdb->prefix . 'digiware_whatsapp_jobs';
        $campaigns_table = $wpdb->prefix . 'digiware_whatsapp_campaigns';

        // Retrieve job
        $job = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$jobs_table} WHERE job_token = %s",
            $token
        ));

        if (!$job) {
            // Token not found, redirect to home safely
            wp_safe_redirect(home_url('/'));
            exit;
        }

        // Update job stats
        $now = current_time('mysql');
        $wpdb->query($wpdb->prepare(
            "UPDATE {$jobs_table} SET 
                click_count = click_count + 1, 
                first_clicked_at = COALESCE(first_clicked_at, %s),
                status = 'clicked'
            WHERE id = %d",
            $now,
            $job->id
        ));

        // Update campaign click count
        if ($job->campaign_id) {
            $wpdb->query($wpdb->prepare(
                "UPDATE {$campaigns_table} SET total_clicks = total_clicks + 1 WHERE id = %d",
                $job->campaign_id
            ));
        }

        // Emit OmniTracker event
        OmniTrackerBridge::record_event('whatsapp_click', array(
            'campaign_id' => $job->campaign_id,
            'job_token'   => $job->job_token,
            'phone_hash'  => hash('sha256', $job->recipient_phone),
            'crm_source'  => $job->crm_source,
            'crm_id'      => $job->crm_id,
            'target_url'  => $job->tracked_url,
            'clicked_at'  => $now,
        ), array(
            'idempotency_key' => 'wa_click_' . $job->job_token . '_' . substr(md5($now), 0, 8),
        ));

        // Redirect to tracked destination URL
        $destination = !empty($job->tracked_url) ? $job->tracked_url : home_url('/');
        wp_redirect($destination, 302);
        exit;
    }
}
