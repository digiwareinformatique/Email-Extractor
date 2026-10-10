<?php
/**
 * Database installer & migrations for DigiWare WhatsApp Business Center
 *
 * @package DigiWare\WhatsApp\Core
 */

namespace DigiWare\WhatsApp\Core;

if (!defined('ABSPATH')) {
    exit;
}

class Installer {

    const DB_VERSION = '2.0.0';

    /**
     * Run installation & schema update
     */
    public static function install() {
        global $wpdb;

        $charset_collate = $wpdb->get_charset_collate();

        $campaigns_table     = $wpdb->prefix . 'digiware_whatsapp_campaigns';
        $jobs_table          = $wpdb->prefix . 'digiware_whatsapp_jobs';
        $contacts_table      = $wpdb->prefix . 'digiware_whatsapp_contacts';
        $conversations_table = $wpdb->prefix . 'digiware_whatsapp_conversations';
        $messages_table      = $wpdb->prefix . 'digiware_whatsapp_messages';
        $templates_table     = $wpdb->prefix . 'digiware_whatsapp_templates';
        $links_table         = $wpdb->prefix . 'digiware_whatsapp_links';

        // 1. Campaigns table (supports multi-segment & multi-template)
        $sql_campaigns = "CREATE TABLE IF NOT EXISTS {$campaigns_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            campaign_slug VARCHAR(64) NOT NULL,
            name VARCHAR(255) NOT NULL,
            objective VARCHAR(255) NOT NULL DEFAULT '',
            template_content TEXT NOT NULL,
            target_url VARCHAR(500) NOT NULL DEFAULT '',
            daily_limit INT(11) NOT NULL DEFAULT 50,
            multi_segments_json LONGTEXT,
            utm_source VARCHAR(64) NOT NULL DEFAULT 'whatsapp',
            utm_medium VARCHAR(64) NOT NULL DEFAULT 'direct_message',
            utm_campaign VARCHAR(128) NOT NULL DEFAULT '',
            utm_content VARCHAR(128) NOT NULL DEFAULT '',
            status VARCHAR(32) NOT NULL DEFAULT 'draft',
            total_jobs INT(11) NOT NULL DEFAULT 0,
            total_clicks INT(11) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY idx_slug (campaign_slug)
        ) {$charset_collate};";

        // 2. Jobs table
        $sql_jobs = "CREATE TABLE IF NOT EXISTS {$jobs_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            campaign_id BIGINT(20) UNSIGNED NOT NULL,
            segment_id VARCHAR(64) NOT NULL DEFAULT '',
            template_id VARCHAR(64) NOT NULL DEFAULT '',
            job_token VARCHAR(64) NOT NULL,
            recipient_phone VARCHAR(32) NOT NULL,
            recipient_name VARCHAR(128) NOT NULL DEFAULT '',
            crm_source VARCHAR(64) NOT NULL DEFAULT 'manual',
            crm_id VARCHAR(64) NOT NULL DEFAULT '',
            variables_json LONGTEXT,
            prepared_message LONGTEXT NOT NULL,
            tracked_url VARCHAR(1000) NOT NULL,
            idempotency_key VARCHAR(128) NOT NULL DEFAULT '',
            sender_job_id VARCHAR(128) NOT NULL DEFAULT '',
            status VARCHAR(32) NOT NULL DEFAULT 'prepared',
            sender_error TEXT,
            exported_at DATETIME DEFAULT NULL,
            first_clicked_at DATETIME DEFAULT NULL,
            click_count INT(11) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY idx_job_token (job_token),
            KEY idx_campaign_id (campaign_id),
            KEY idx_phone (recipient_phone),
            KEY idx_status (status)
        ) {$charset_collate};";

        // 3. CRM Contacts table
        $sql_contacts = "CREATE TABLE IF NOT EXISTS {$contacts_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            contact_id VARCHAR(64) NOT NULL,
            first_name VARCHAR(128) NOT NULL DEFAULT '',
            last_name VARCHAR(128) NOT NULL DEFAULT '',
            civility VARCHAR(32) NOT NULL DEFAULT '',
            profession VARCHAR(128) NOT NULL DEFAULT '',
            job_title VARCHAR(128) NOT NULL DEFAULT '',
            preferred_salutation VARCHAR(64) NOT NULL DEFAULT '',
            phone VARCHAR(32) NOT NULL,
            email VARCHAR(128) NOT NULL DEFAULT '',
            company VARCHAR(128) NOT NULL DEFAULT '',
            address VARCHAR(255) NOT NULL DEFAULT '',
            city VARCHAR(64) NOT NULL DEFAULT '',
            sector VARCHAR(64) NOT NULL DEFAULT '',
            tags_json LONGTEXT,
            segments_json LONGTEXT,
            commercial_status VARCHAR(64) NOT NULL DEFAULT 'prospect',
            opt_in TINYINT(1) NOT NULL DEFAULT 1,
            notes LONGTEXT,
            wc_order_id VARCHAR(64) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY idx_contact_id (contact_id),
            KEY idx_phone (phone),
            KEY idx_email (email)
        ) {$charset_collate};";

        // 4. Conversations table
        $sql_conversations = "CREATE TABLE IF NOT EXISTS {$conversations_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            conversation_id VARCHAR(64) NOT NULL,
            contact_id VARCHAR(64) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'open',
            assigned_to VARCHAR(64) NOT NULL DEFAULT 'human',
            last_message_preview TEXT,
            unread_count INT(11) NOT NULL DEFAULT 0,
            last_activity_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY idx_conversation_id (conversation_id),
            KEY idx_contact_id (contact_id),
            KEY idx_status (status)
        ) {$charset_collate};";

        // 5. Messages table
        $sql_messages = "CREATE TABLE IF NOT EXISTS {$messages_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            message_id VARCHAR(64) NOT NULL,
            conversation_id VARCHAR(64) NOT NULL,
            contact_id VARCHAR(64) NOT NULL,
            direction ENUM('inbound', 'outbound') NOT NULL DEFAULT 'outbound',
            sender_type ENUM('human', 'ai', 'system') NOT NULL DEFAULT 'human',
            author_name VARCHAR(128) NOT NULL DEFAULT '',
            content LONGTEXT NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'sent',
            sender_job_id VARCHAR(128) NOT NULL DEFAULT '',
            error_message TEXT,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY idx_message_id (message_id),
            KEY idx_conversation_id (conversation_id),
            KEY idx_contact_id (contact_id)
        ) {$charset_collate};";

        // 6. Templates table
        $sql_templates = "CREATE TABLE IF NOT EXISTS {$templates_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            template_id VARCHAR(64) NOT NULL,
            name VARCHAR(128) NOT NULL,
            category VARCHAR(64) NOT NULL DEFAULT 'general',
            description VARCHAR(255) NOT NULL DEFAULT '',
            content LONGTEXT NOT NULL,
            conditions_json LONGTEXT,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY idx_template_id (template_id)
        ) {$charset_collate};";

        // 7. Link Center table
        $sql_links = "CREATE TABLE IF NOT EXISTS {$links_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            link_id VARCHAR(64) NOT NULL,
            target_url VARCHAR(500) NOT NULL,
            campaign_id VARCHAR(64) NOT NULL DEFAULT '',
            contact_id VARCHAR(64) NOT NULL DEFAULT '',
            utm_source VARCHAR(64) NOT NULL DEFAULT 'whatsapp',
            utm_medium VARCHAR(64) NOT NULL DEFAULT 'direct_message',
            utm_campaign VARCHAR(128) NOT NULL DEFAULT '',
            utm_content VARCHAR(128) NOT NULL DEFAULT '',
            utm_term VARCHAR(128) NOT NULL DEFAULT '',
            ot_context_json LONGTEXT,
            click_count INT(11) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY idx_link_id (link_id)
        ) {$charset_collate};";

        // ========================================================
        // 8. AUTONOMOUS MODULE: WHATSAPP SENDER (wasender_*)
        // ========================================================
        $wasender_jobs_table       = $wpdb->prefix . 'wasender_jobs';
        $wasender_blacklist_table  = $wpdb->prefix . 'wasender_blacklist';
        $wasender_logs_table       = $wpdb->prefix . 'wasender_logs';
        $wasender_settings_table   = $wpdb->prefix . 'wasender_settings';
        $wasender_replies_table    = $wpdb->prefix . 'wasender_replies';
        $wasender_campaigns_table  = $wpdb->prefix . 'wasender_campaigns';

        // 8.1 wasender_jobs
        $sql_wasender_jobs = "CREATE TABLE IF NOT EXISTS {$wasender_jobs_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            contact_id VARCHAR(64) DEFAULT NULL,
            phone VARCHAR(32) NOT NULL,
            campaign_id BIGINT(20) UNSIGNED DEFAULT NULL,
            template_id BIGINT(20) UNSIGNED DEFAULT NULL,
            message_raw LONGTEXT NOT NULL,
            message_final LONGTEXT NOT NULL,
            metadata LONGTEXT,
            status ENUM('queued', 'processing', 'sent', 'delivered', 'read', 'failed', 'held_undelivered', 'opted_out') NOT NULL DEFAULT 'queued',
            attempts INT(11) NOT NULL DEFAULT 0,
            error TEXT,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            sent_at DATETIME DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_status (status),
            KEY idx_phone (phone),
            KEY idx_campaign (campaign_id)
        ) {$charset_collate};";

        // 8.2 wasender_blacklist
        $sql_wasender_blacklist = "CREATE TABLE IF NOT EXISTS {$wasender_blacklist_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            phone VARCHAR(32) NOT NULL,
            reason VARCHAR(255) NOT NULL DEFAULT '',
            matched_keyword VARCHAR(64) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY idx_phone (phone)
        ) {$charset_collate};";

        // 8.3 wasender_logs
        $sql_wasender_logs = "CREATE TABLE IF NOT EXISTS {$wasender_logs_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            job_id BIGINT(20) UNSIGNED DEFAULT NULL,
            level ENUM('info', 'warn', 'error') NOT NULL DEFAULT 'info',
            message TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY idx_job_id (job_id),
            KEY idx_level (level)
        ) {$charset_collate};";

        // 8.4 wasender_settings
        $sql_wasender_settings = "CREATE TABLE IF NOT EXISTS {$wasender_settings_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            setting_key VARCHAR(64) NOT NULL,
            setting_value LONGTEXT NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY idx_setting_key (setting_key)
        ) {$charset_collate};";

        // 8.5 wasender_replies
        $sql_wasender_replies = "CREATE TABLE IF NOT EXISTS {$wasender_replies_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            phone VARCHAR(32) NOT NULL,
            message TEXT NOT NULL,
            is_optout TINYINT(1) NOT NULL DEFAULT 0,
            matched_keyword VARCHAR(64) NOT NULL DEFAULT '',
            received_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY idx_phone (phone),
            KEY idx_is_optout (is_optout)
        ) {$charset_collate};";

        // 8.6 wasender_campaigns
        $sql_wasender_campaigns = "CREATE TABLE IF NOT EXISTS {$wasender_campaigns_table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            template_id BIGINT(20) UNSIGNED DEFAULT NULL,
            status ENUM('queued', 'running', 'paused', 'done') NOT NULL DEFAULT 'queued',
            total INT(11) NOT NULL DEFAULT 0,
            sent INT(11) NOT NULL DEFAULT 0,
            failed INT(11) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY idx_status (status)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql_campaigns);
        dbDelta($sql_jobs);
        dbDelta($sql_contacts);
        dbDelta($sql_conversations);
        dbDelta($sql_messages);
        dbDelta($sql_templates);
        dbDelta($sql_links);

        // Run dbDelta for wasender_* tables
        dbDelta($sql_wasender_jobs);
        dbDelta($sql_wasender_blacklist);
        dbDelta($sql_wasender_logs);
        dbDelta($sql_wasender_settings);
        dbDelta($sql_wasender_replies);
        dbDelta($sql_wasender_campaigns);

        update_option('digiware_whatsapp_db_version', self::DB_VERSION);

        // Seed default wasender settings if empty
        $existing_token = $wpdb->get_var($wpdb->prepare(
            "SELECT setting_value FROM {$wasender_settings_table} WHERE setting_key = %s",
            'api_token'
        ));

        if (!$existing_token) {
            $token = 'was_' . bin2hex(random_bytes(16));
            $now = current_time('mysql');

            $default_wasender_settings = array(
                'api_token'              => $token,
                'delai_min'              => 8,
                'delai_max'              => 20,
                'taille_lot'             => 15,
                'pause_entre_lots'       => 5,
                'quota_journalier'       => 50,
                'heures_travail_debut'   => '08:30',
                'heures_travail_fin'     => '19:30',
                'rampe_warmup'           => true,
                'randomisation'          => true,
                'default_country_prefix' => '216',
                'queue_paused'           => false,
            );

            foreach ($default_wasender_settings as $k => $v) {
                $stored = is_bool($v) || is_array($v) ? wp_json_encode($v) : (string) $v;
                $wpdb->insert($wasender_settings_table, array(
                    'setting_key'   => $k,
                    'setting_value' => $stored,
                    'updated_at'    => $now,
                ));
            }
        }

        // Seed default settings
        $settings = get_option('digiware_whatsapp_settings', array());
        $defaults = array(
            'default_country_prefix' => '212',
            'sender_endpoint'        => 'https://ais-pre-zgivmj2nevegi7svqhki6j-365608931211.europe-west2.run.app',
            'sender_api_key'         => '',
            'sender_rate_limit'      => 15,
            'omnitracker_endpoint'   => home_url('/wp-json/digiware/v1/omnitracker'),
            'ai_mode'                => 'suggestion',
            'installed_at'           => current_time('mysql'),
        );
        update_option('digiware_whatsapp_settings', wp_parse_args($settings, $defaults));
    }
}
