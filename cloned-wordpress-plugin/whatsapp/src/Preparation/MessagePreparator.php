<?php
/**
 * Core Message Preparator & Orchestrator
 *
 * Implements the business preparation layer between CRM/commercial data and WhatsApp Sender:
 * 1. Resolves contact context, civilities and professional titles
 * 2. Multi-segment and multi-template distribution
 * 3. Generates unique tokens and tracking URLs with OmniTracker context
 * 4. Resolves spintax and condition rules
 * 5. Produces immutable final messages ready for direct transmission to the WhatsApp Sender
 *
 * @package DigiWare\WhatsApp\Preparation
 */

namespace DigiWare\WhatsApp\Preparation;

use DigiWare\WhatsApp\Core\Normalizer;
use DigiWare\WhatsApp\Tracking\LinkTracker;
use DigiWare\WhatsApp\Tracking\OmniTrackerBridge;
use DigiWare\WhatsApp\Sender\WhatsAppSenderAdapter;

if (!defined('ABSPATH')) {
    exit;
}

class MessagePreparator {

    /**
     * Compute contextual salutation without gender inference
     *
     * @param array $contact
     * @return string
     */
    public static function build_salutation(array $contact) {
        $civility   = !empty($contact['civility']) ? trim($contact['civility']) : '';
        $profession = !empty($contact['profession']) ? trim($contact['profession']) : '';
        $job_title  = !empty($contact['job_title']) ? trim($contact['job_title']) : '';
        $last_name  = !empty($contact['last_name']) ? trim($contact['last_name']) : '';
        $first_name = !empty($contact['first_name']) ? trim($contact['first_name']) : '';

        // If specific professional title exists (e.g., Maître, Docteur)
        if (!empty($civility) && in_array($civility, array('Maître', 'Docteur', 'Professeur'))) {
            return $last_name ? "Bonjour {$civility} {$last_name}," : "Bonjour {$civility},";
        }

        // Explicit civility (Monsieur / Madame)
        if (!empty($civility) && in_array($civility, array('Monsieur', 'Madame'))) {
            return $last_name ? "Bonjour {$civility} {$last_name}," : "Bonjour {$civility},";
        }

        // Neutral and respectful fallback: never guess gender
        if (!empty($first_name)) {
            return "Bonjour {$first_name},";
        }

        return "Bonjour,";
    }

    /**
     * Resolve spintax variations: {A|B|C}
     *
     * @param string $text
     * @return string
     */
    public static function resolve_spintax($text) {
        $pattern = '/\{([^{}]+)\}/';
        $max_loops = 8;
        while ($max_loops-- > 0 && preg_match($pattern, $text)) {
            $text = preg_replace_callback($pattern, function($matches) {
                $options = explode('|', $matches[1]);
                return trim($options[array_rand($options)]);
            }, $text);
        }
        return $text;
    }

    /**
     * Interpolate variables and conditional rules into template
     *
     * @param string $template
     * @param array $contact
     * @param string $tracked_url
     * @param array $extra_vars
     * @return string
     */
    public static function render_message($template, array $contact, $tracked_url, array $extra_vars = array()) {
        $first_name = !empty($contact['first_name']) ? trim($contact['first_name']) : '';
        $last_name  = !empty($contact['last_name']) ? trim($contact['last_name']) : '';
        $full_name  = trim($first_name . ' ' . $last_name) ?: 'Client';
        $company    = !empty($contact['company']) ? trim($contact['company']) : '';
        $profession = !empty($contact['profession']) ? trim($contact['profession']) : '';
        $job_title  = !empty($contact['job_title']) ? trim($contact['job_title']) : '';
        $civility   = !empty($contact['civility']) ? trim($contact['civility']) : '';
        $city       = !empty($contact['city']) ? trim($contact['city']) : '';
        $address    = !empty($contact['address']) ? trim($contact['address']) : '';
        $phone      = Normalizer::clean_phone(!empty($contact['phone']) ? $contact['phone'] : '');
        $salutation = self::build_salutation($contact);

        // 1. Spintax
        $rendered = self::resolve_spintax($template);

        // 2. Simple conditional blocks: {{#if company}}...{{/if}}
        if (!empty($company)) {
            $rendered = preg_replace('/\{\{#if company\}\}(.*?)\{\{\/if\}\}/s', '$1', $rendered);
        } else {
            $rendered = preg_replace('/\{\{#if company\}\}(.*?)\{\{\/if\}\}/s', '', $rendered);
        }

        if (!empty($profession)) {
            $rendered = preg_replace('/\{\{#if profession\}\}(.*?)\{\{\/if\}\}/s', '$1', $rendered);
        } else {
            $rendered = preg_replace('/\{\{#if profession\}\}(.*?)\{\{\/if\}\}/s', '', $rendered);
        }

        // 3. Variable replacements
        $vars = array(
            '{{salutation}}'     => $salutation,
            '{{civility}}'       => $civility,
            '{{first_name}}'     => $first_name ?: $full_name,
            '{{last_name}}'      => $last_name,
            '{{name}}'           => $full_name,
            '{{full_name}}'      => $full_name,
            '{{company}}'        => $company,
            '{{company_name}}'   => $company,
            '{{profession}}'     => $profession,
            '{{job_title}}'      => $job_title,
            '{{city}}'           => $city,
            '{{address}}'        => $address,
            '{{phone}}'          => $phone,
            '{{tracking_link}}'  => $tracked_url,
            '{{link}}'           => $tracked_url,
            '{{order_id}}'       => !empty($contact['order_id']) ? $contact['order_id'] : '',
            '{{product_name}}'   => !empty($contact['product_name']) ? $contact['product_name'] : (!empty($extra_vars['product_name']) ? $extra_vars['product_name'] : ''),
            '{{campaign_name}}'  => !empty($extra_vars['campaign_name']) ? $extra_vars['campaign_name'] : '',
        );

        return trim(str_replace(array_keys($vars), array_values($vars), $rendered));
    }

    /**
     * Prepare a multi-segment campaign batch of message jobs
     *
     * @param int|array $campaign Campaign ID or array with campaign details
     * @param array $segment_distributions Array of ['segment_id' => ..., 'template_content' => ..., 'contacts' => ...]
     * @param array $options Options (e.g. use_short_redirect)
     * @return array Result summary
     */
    public static function prepare_multi_segment_batch($campaign, array $segment_distributions, array $options = array()) {
        global $wpdb;

        $campaigns_table = $wpdb->prefix . 'digiware_whatsapp_campaigns';
        $jobs_table      = $wpdb->prefix . 'digiware_whatsapp_jobs';

        $campaign_id = 0;
        $campaign_data = array();

        if (is_numeric($campaign)) {
            $campaign_data = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$campaigns_table} WHERE id = %d", (int) $campaign), ARRAY_A);
            $campaign_id = (int) $campaign;
        } elseif (is_array($campaign)) {
            $slug = !empty($campaign['slug']) ? sanitize_title($campaign['slug']) : 'camp_' . date('Ymd_His');
            $existing = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$campaigns_table} WHERE campaign_slug = %s", $slug), ARRAY_A);

            if ($existing) {
                $campaign_id = (int) $existing['id'];
                $campaign_data = $existing;
            } else {
                $wpdb->insert($campaigns_table, array(
                    'campaign_slug'       => $slug,
                    'name'                => !empty($campaign['name']) ? sanitize_text_field($campaign['name']) : 'Campagne ' . date('d/m/Y H:i'),
                    'objective'           => !empty($campaign['objective']) ? sanitize_text_field($campaign['objective']) : '',
                    'template_content'    => !empty($campaign['template_content']) ? $campaign['template_content'] : '',
                    'target_url'          => !empty($campaign['target_url']) ? esc_url_raw($campaign['target_url']) : home_url('/'),
                    'daily_limit'         => !empty($campaign['daily_limit']) ? (int) $campaign['daily_limit'] : 50,
                    'multi_segments_json' => !empty($campaign['multi_segments']) ? wp_json_encode($campaign['multi_segments']) : null,
                    'status'              => 'prepared',
                    'total_jobs'          => 0,
                    'total_clicks'        => 0,
                    'created_at'          => current_time('mysql'),
                    'updated_at'          => current_time('mysql'),
                ));
                $campaign_id = $wpdb->insert_id;
                $campaign_data = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$campaigns_table} WHERE id = %d", $campaign_id), ARRAY_A);
            }
        }

        if (empty($campaign_data)) {
            return array('success' => false, 'error' => 'Campagne introuvable.');
        }

        $slug         = $campaign_data['campaign_slug'];
        $target_url   = !empty($campaign_data['target_url']) ? $campaign_data['target_url'] : home_url('/');
        $use_redirect = isset($options['use_short_redirect']) ? (bool) $options['use_short_redirect'] : true;
        $prepared_jobs = array();
        $now = current_time('mysql');

        foreach ($segment_distributions as $dist) {
            $segment_id       = !empty($dist['segment_id']) ? sanitize_text_field($dist['segment_id']) : 'default';
            $template_content = !empty($dist['template_content']) ? $dist['template_content'] : $campaign_data['template_content'];
            $contacts         = !empty($dist['contacts']) && is_array($dist['contacts']) ? $dist['contacts'] : array();
            $quota            = !empty($dist['daily_quota']) ? (int) $dist['daily_quota'] : count($contacts);

            $processed_count = 0;
            foreach ($contacts as $contact) {
                if ($processed_count >= $quota) {
                    break;
                }

                $phone = Normalizer::clean_phone(!empty($contact['phone']) ? $contact['phone'] : '');
                if (empty($phone) || !Normalizer::is_valid_phone($phone)) {
                    continue;
                }

                $job_token = 'job_' . substr(md5(uniqid(wp_rand(), true)), 0, 12);
                $idempotency_key = "idemp_{$campaign_id}_{$segment_id}_" . md5($phone . '_' . $job_token);

                $full_tracked_url = LinkTracker::build_tracked_url(
                    $target_url,
                    $slug,
                    $job_token,
                    array(
                        'utm_medium'  => 'direct_message',
                        'utm_content' => $segment_id,
                    )
                );

                $message_link = $use_redirect ? LinkTracker::build_redirect_url($job_token) : $full_tracked_url;
                $final_message = self::render_message($template_content, $contact, $message_link, array('campaign_name' => $campaign_data['name']));

                $wpdb->insert($jobs_table, array(
                    'campaign_id'      => $campaign_id,
                    'segment_id'       => $segment_id,
                    'template_id'      => !empty($dist['template_id']) ? $dist['template_id'] : 'tmpl_1',
                    'job_token'        => $job_token,
                    'recipient_phone'  => $phone,
                    'recipient_name'   => trim((!empty($contact['first_name']) ? $contact['first_name'] : '') . ' ' . (!empty($contact['last_name']) ? $contact['last_name'] : '')),
                    'crm_source'       => !empty($contact['crm_source']) ? sanitize_text_field($contact['crm_source']) : 'manual',
                    'crm_id'           => !empty($contact['contact_id']) ? sanitize_text_field($contact['contact_id']) : '',
                    'variables_json'   => wp_json_encode($contact),
                    'prepared_message' => $final_message,
                    'tracked_url'      => $full_tracked_url,
                    'idempotency_key'  => $idempotency_key,
                    'status'           => 'prepared',
                    'created_at'       => $now,
                ));

                $prepared_jobs[] = array(
                    'job_id'          => $wpdb->insert_id,
                    'token'           => $job_token,
                    'phone'           => $phone,
                    'segment_id'      => $segment_id,
                    'message'         => $final_message,
                    'link'            => $message_link,
                    'idempotency_key' => $idempotency_key,
                );

                $processed_count++;
            }
        }

        // Update campaign totals
        $total = count($prepared_jobs);
        if ($total > 0) {
            $wpdb->query($wpdb->prepare(
                "UPDATE {$campaigns_table} SET total_jobs = total_jobs + %d, status = 'prepared', updated_at = %s WHERE id = %d",
                $total,
                $now,
                $campaign_id
            ));
        }

        return array(
            'success'     => true,
            'campaign_id' => $campaign_id,
            'count'       => $total,
            'jobs'        => $prepared_jobs,
        );
    }
}
