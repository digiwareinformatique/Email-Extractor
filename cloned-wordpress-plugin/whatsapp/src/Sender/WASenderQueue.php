<?php
/**
 * Gestionnaire de la File d'Attente & Réglages Anti-Ban WhatsApp Sender
 *
 * @package DigiWare\WhatsApp\Sender
 */

namespace DigiWare\WhatsApp\Sender;

if (!defined('ABSPATH')) {
    exit;
}

class WASenderQueue {

    /**
     * Récupère un réglage du module WhatsApp Sender
     *
     * @param string $key Clé de configuration
     * @param mixed $default Valeur par défaut
     * @return mixed
     */
    public static function get_setting($key, $default = null) {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_settings';

        $val = $wpdb->get_var($wpdb->prepare(
            "SELECT setting_value FROM {$table} WHERE setting_key = %s",
            $key
        ));

        if ($val === null) {
            return $default;
        }

        $decoded = json_decode($val, true);
        return $decoded !== null ? $decoded : $val;
    }

    /**
     * Enregistre ou met à jour un réglage
     *
     * @param string $key Clé de configuration
     * @param mixed $value Valeur
     * @return bool
     */
    public static function set_setting($key, $value) {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_settings';

        $stored_val = is_array($value) || is_object($value) || is_bool($value) 
            ? wp_json_encode($value) 
            : (string) $value;

        $exists = $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE setting_key = %s",
            $key
        ));

        if ($exists) {
            return (bool) $wpdb->update(
                $table,
                array(
                    'setting_value' => $stored_val,
                    'updated_at'    => current_time('mysql'),
                ),
                array('setting_key' => $key)
            );
        }

        return (bool) $wpdb->insert(
            $table,
            array(
                'setting_key'   => $key,
                'setting_value' => $stored_val,
                'updated_at'    => current_time('mysql'),
            )
        );
    }

    /**
     * Retourne l'ensemble des réglages anti-ban et système
     *
     * @return array
     */
    public static function get_all_settings() {
        return array(
            'delai_min'             => (int) self::get_setting('delai_min', 8),
            'delai_max'             => (int) self::get_setting('delai_max', 20),
            'taille_lot'            => (int) self::get_setting('taille_lot', 15),
            'pause_entre_lots'      => (int) self::get_setting('pause_entre_lots', 5), // minutes
            'quota_journalier'      => (int) self::get_setting('quota_journalier', 50),
            'heures_travail_debut'  => (string) self::get_setting('heures_travail_debut', '08:30'),
            'heures_travail_fin'    => (string) self::get_setting('heures_travail_fin', '19:30'),
            'rampe_warmup'          => (bool) self::get_setting('rampe_warmup', true),
            'randomisation'         => (bool) self::get_setting('randomisation', true),
            'default_country_prefix'=> (string) self::get_setting('default_country_prefix', '216'),
            'api_token'             => (string) self::get_setting('api_token', ''),
            'queue_paused'          => (bool) self::get_setting('queue_paused', false),
            'last_node_ping'        => self::get_setting('last_node_ping', null),
        );
    }

    /**
     * Vérifie si un numéro est présent dans la liste noire
     *
     * @param string $phone Numéro E.164
     * @return bool
     */
    public static function is_blacklisted($phone) {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_blacklist';

        $clean = preg_replace('/[^\d+]/', '', $phone);
        $count = $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE phone = %s",
            $clean
        ));

        return ((int) $count) > 0;
    }

    /**
     * Ajoute un numéro à la liste noire (Opt-out)
     *
     * @param string $phone
     * @param string $reason
     * @param string $matched_keyword
     * @return bool
     */
    public static function add_to_blacklist($phone, $reason = 'Opt-out manuel', $matched_keyword = '') {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_blacklist';
        $jobs_table = $wpdb->prefix . 'wasender_jobs';

        $clean = preg_replace('/[^\d+]/', '', $phone);
        if (empty($clean)) {
            return false;
        }

        if (self::is_blacklisted($clean)) {
            return true;
        }

        $inserted = $wpdb->insert(
            $table,
            array(
                'phone'           => $clean,
                'reason'          => sanitize_text_field($reason),
                'matched_keyword' => sanitize_text_field($matched_keyword),
                'created_at'      => current_time('mysql'),
            )
        );

        // Passer automatiquement tous les jobs en attente de ce numéro à 'opted_out'
        $wpdb->query($wpdb->prepare(
            "UPDATE {$jobs_table} 
             SET status = 'opted_out', updated_at = %s 
             WHERE phone = %s AND status IN ('queued', 'processing')",
            current_time('mysql'),
            $clean
        ));

        self::log(null, 'warn', "Numéro {$clean} ajouté en liste noire ({$reason} - Mot-clé: {$matched_keyword})");

        return (bool) $inserted;
    }

    /**
     * Supprime un numéro de la liste noire
     *
     * @param int $id Identifiant blacklist
     * @return bool
     */
    public static function remove_from_blacklist($id) {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_blacklist';
        return (bool) $wpdb->delete($table, array('id' => (int) $id));
    }

    /**
     * Écrit une entrée dans le journal wasender_logs
     *
     * @param int|null $job_id
     * @param string $level info|warn|error
     * @param string $message
     * @return bool
     */
    public static function log($job_id, $level, $message) {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_logs';

        return (bool) $wpdb->insert(
            $table,
            array(
                'job_id'     => $job_id ? (int) $job_id : null,
                'level'      => in_array($level, array('info', 'warn', 'error'), true) ? $level : 'info',
                'message'    => sanitize_text_field($message),
                'created_at' => current_time('mysql'),
            )
        );
    }

    /**
     * Crée un lot de jobs à partir d'une campagne
     *
     * @param string $campaign_name Nom de la campagne
     * @param string $template Modèle de message avec Spintax et variables
     * @param array $contacts Liste des contacts [{phone, nom, prenom, entreprise, ville, specialite, ...}]
     * @param int|null $template_id Identifiant du template optionnel
     * @return array [ 'success' => bool, 'campaign_id' => int, 'jobs_created' => int, 'skipped_blacklisted' => int, 'invalid_phones' => int ]
     */
    public static function create_bulk_jobs($campaign_name, $template, array $contacts, $template_id = null) {
        global $wpdb;
        $campaigns_table = $wpdb->prefix . 'wasender_campaigns';
        $jobs_table      = $wpdb->prefix . 'wasender_jobs';

        $settings = self::get_all_settings();
        $default_prefix = !empty($settings['default_country_prefix']) ? $settings['default_country_prefix'] : '216';

        // 1. Création de la campagne
        $wpdb->insert(
            $campaigns_table,
            array(
                'name'        => sanitize_text_field($campaign_name),
                'template_id' => $template_id ? (int) $template_id : null,
                'status'      => 'queued',
                'total'       => count($contacts),
                'sent'        => 0,
                'failed'      => 0,
                'created_at'  => current_time('mysql'),
            )
        );
        $campaign_id = $wpdb->insert_id;

        $created = 0;
        $skipped_blacklisted = 0;
        $invalid_phones = 0;

        foreach ($contacts as $contact) {
            $raw_phone = !empty($contact['phone']) ? $contact['phone'] : '';
            $phone = WASenderEngine::validateAndFormatPhone($raw_phone, $default_prefix);

            if (!$phone) {
                $invalid_phones++;
                continue;
            }

            // Vérification Blacklist préalable
            if (self::is_blacklisted($phone)) {
                $skipped_blacklisted++;
                continue;
            }

            // Calcul du message final pour ce contact (Interpolation + Spintax)
            $meta = is_array($contact) ? $contact : array();
            $message_final = WASenderEngine::processOutreachMessage($template, $meta, $phone);

            $contact_id = !empty($contact['contact_id']) ? sanitize_text_field($contact['contact_id']) : (!empty($contact['id']) ? sanitize_text_field($contact['id']) : null);

            $wpdb->insert(
                $jobs_table,
                array(
                    'contact_id'    => $contact_id,
                    'phone'         => $phone,
                    'campaign_id'   => $campaign_id,
                    'template_id'   => $template_id ? (int) $template_id : null,
                    'message_raw'   => $template,
                    'message_final' => $message_final,
                    'metadata'      => wp_json_encode($meta),
                    'status'        => 'queued',
                    'attempts'      => 0,
                    'error'         => null,
                    'created_at'    => current_time('mysql'),
                    'updated_at'    => current_time('mysql'),
                )
            );
            $created++;
        }

        // Mettre à jour le total réel dans la campagne
        $wpdb->update(
            $campaigns_table,
            array('total' => $created),
            array('id' => $campaign_id)
        );

        self::log(null, 'info', "Campagne #{$campaign_id} '{$campaign_name}' créée avec {$created} jobs ({$skipped_blacklisted} blacklistés, {$invalid_phones} invalides).");

        return array(
            'success'             => true,
            'campaign_id'         => $campaign_id,
            'jobs_created'        => $created,
            'skipped_blacklisted' => $skipped_blacklisted,
            'invalid_phones'      => $invalid_phones,
        );
    }

    /**
     * Récupère et réserve N jobs pour la "main" Node
     * Passe immédiatement les jobs de 'queued' à 'processing'
     *
     * @param int $limit Nombre de jobs max (ex. 10)
     * @return array Liste des jobs prêts pour le worker Node
     */
    public static function fetch_next_jobs($limit = 10) {
        global $wpdb;
        $jobs_table = $wpdb->prefix . 'wasender_jobs';

        $limit = max(1, min(50, (int) $limit));

        // Si la file globale est en pause, renvoyer vide
        if (self::get_setting('queue_paused', false)) {
            return array();
        }

        // Récupérer les identifiants des jobs en attente.
        // On EXCLUT les messages de conversation (dw_kind=chat) : ils disposent de
        // leur propre voie rapide (fetch_next_chat_jobs), sans délai ni quota anti-spam.
        $chat_like = '%' . $wpdb->esc_like('"dw_kind":"chat"') . '%';
        $job_ids = $wpdb->get_col($wpdb->prepare(
            "SELECT id FROM {$jobs_table}
             WHERE status = 'queued'
               AND (metadata IS NULL OR metadata NOT LIKE %s)
             ORDER BY id ASC
             LIMIT %d",
            $chat_like,
            $limit
        ));

        if (empty($job_ids)) {
            return array();
        }

        $placeholders = implode(',', array_map('intval', $job_ids));
        $now = current_time('mysql');

        // Passage atomique à 'processing'
        $wpdb->query("UPDATE {$jobs_table} 
                      SET status = 'processing', attempts = attempts + 1, updated_at = '{$now}' 
                      WHERE id IN ({$placeholders})");

        // Récupérer les enregistrements complets
        $rows = $wpdb->get_results("SELECT id, contact_id, phone, campaign_id, template_id, message_final, metadata, attempts, created_at 
                                    FROM {$jobs_table} 
                                    WHERE id IN ({$placeholders}) 
                                    ORDER BY id ASC", ARRAY_A);

        $results = array();
        foreach ($rows as $row) {
            $results[] = array(
                'job_id'        => (int) $row['id'],
                'phone'         => $row['phone'],
                'message_final' => $row['message_final'],
                'contact_id'    => $row['contact_id'],
                'campaign_id'   => $row['campaign_id'] ? (int) $row['campaign_id'] : null,
                'metadata'      => !empty($row['metadata']) ? json_decode($row['metadata'], true) : array(),
                'attempts'      => (int) $row['attempts'],
            );
        }

        return $results;
    }

    /**
     * Crée un message de CONVERSATION (temps réel) : un job unique marqué dw_kind=chat,
     * sans campagne. Emprunte la voie rapide (aucun délai / quota anti-spam) car le
     * client a déjà engagé la discussion — c'est une réponse 1:1, pas de la prospection.
     *
     * @param string $phone   Numéro du destinataire
     * @param string $message Texte à envoyer
     * @return array [ 'success' => bool, 'job_id' => int, 'phone' => string, 'error' => string ]
     */
    public static function create_chat_message($phone, $message) {
        global $wpdb;
        $jobs_table = $wpdb->prefix . 'wasender_jobs';

        $settings = self::get_all_settings();
        $default_prefix = !empty($settings['default_country_prefix']) ? $settings['default_country_prefix'] : '216';
        $fmt = WASenderEngine::validateAndFormatPhone($phone, $default_prefix);
        if (!$fmt) {
            return array('success' => false, 'error' => 'invalid_phone');
        }

        $message = (string) $message;
        $now = current_time('mysql');
        $wpdb->insert(
            $jobs_table,
            array(
                'contact_id'    => null,
                'phone'         => $fmt,
                'campaign_id'   => null,
                'template_id'   => null,
                'message_raw'   => $message,
                'message_final' => $message,
                'metadata'      => wp_json_encode(array('dw_kind' => 'chat')),
                'status'        => 'queued',
                'attempts'      => 0,
                'error'         => null,
                'created_at'    => $now,
                'updated_at'    => $now,
            )
        );
        $id = (int) $wpdb->insert_id;
        if ($id) {
            self::log($id, 'info', "Message conversation #{$id} vers {$fmt} mis en file (voie rapide).");
        }
        return array('success' => (bool) $id, 'job_id' => $id, 'phone' => $fmt);
    }

    /**
     * Voie rapide : récupère et réserve les messages de CONVERSATION en attente.
     * Identique à fetch_next_jobs mais filtre sur dw_kind=chat et IGNORE la pause
     * globale de campagne (une conversation temps réel ne se met pas en pause).
     *
     * @param int $limit Nombre de messages max
     * @return array Liste des messages prêts pour la "main" Node
     */
    public static function fetch_next_chat_jobs($limit = 5) {
        global $wpdb;
        $jobs_table = $wpdb->prefix . 'wasender_jobs';

        $limit = max(1, min(20, (int) $limit));

        $chat_like = '%' . $wpdb->esc_like('"dw_kind":"chat"') . '%';
        $job_ids = $wpdb->get_col($wpdb->prepare(
            "SELECT id FROM {$jobs_table}
             WHERE status = 'queued'
               AND metadata LIKE %s
             ORDER BY id ASC
             LIMIT %d",
            $chat_like,
            $limit
        ));

        if (empty($job_ids)) {
            return array();
        }

        $placeholders = implode(',', array_map('intval', $job_ids));
        $now = current_time('mysql');

        $wpdb->query("UPDATE {$jobs_table}
                      SET status = 'processing', attempts = attempts + 1, updated_at = '{$now}'
                      WHERE id IN ({$placeholders})");

        $rows = $wpdb->get_results("SELECT id, phone, message_final, metadata, attempts
                                    FROM {$jobs_table}
                                    WHERE id IN ({$placeholders})
                                    ORDER BY id ASC", ARRAY_A);

        $results = array();
        foreach ($rows as $row) {
            $results[] = array(
                'job_id'        => (int) $row['id'],
                'phone'         => $row['phone'],
                'message_final' => $row['message_final'],
                'metadata'      => !empty($row['metadata']) ? json_decode($row['metadata'], true) : array(),
                'attempts'      => (int) $row['attempts'],
                'kind'          => 'chat',
            );
        }

        return $results;
    }

    /**
     * Met à jour le statut d'un job après exécution par la main Node
     *
     * @param int $job_id Identifiant du job
     * @param string $status sent|delivered|read|failed|held_undelivered
     * @param string $detail Détail ou code d'erreur
     * @return bool
     */
    public static function update_job_status($job_id, $status, $detail = '') {
        global $wpdb;
        $jobs_table      = $wpdb->prefix . 'wasender_jobs';
        $campaigns_table = $wpdb->prefix . 'wasender_campaigns';

        $valid_statuses = array('queued', 'processing', 'sent', 'delivered', 'read', 'failed', 'held_undelivered', 'opted_out');
        if (!in_array($status, $valid_statuses, true)) {
            return false;
        }

        $now = current_time('mysql');
        $update_data = array(
            'status'     => $status,
            'updated_at' => $now,
        );

        if ($status === 'sent') {
            $update_data['sent_at'] = $now;
        }

        if (!empty($detail) && in_array($status, array('failed', 'held_undelivered'), true)) {
            $update_data['error'] = sanitize_text_field($detail);
        }

        $job = $wpdb->get_row($wpdb->prepare(
            "SELECT id, campaign_id, phone FROM {$jobs_table} WHERE id = %d",
            (int) $job_id
        ));

        if (!$job) {
            return false;
        }

        $updated = $wpdb->update(
            $jobs_table,
            $update_data,
            array('id' => (int) $job_id)
        );

        // Logs
        $level = in_array($status, array('failed', 'held_undelivered'), true) ? 'error' : 'info';
        self::log((int) $job_id, $level, "Job #{$job_id} ({$job->phone}) passé à l'état '{$status}'" . ($detail ? " - {$detail}" : ''));

        // Mise à jour des compteurs de la campagne
        if (!empty($job->campaign_id)) {
            $counts = $wpdb->get_row($wpdb->prepare(
                "SELECT 
                    SUM(CASE WHEN status = 'sent' OR status = 'delivered' OR status = 'read' THEN 1 ELSE 0 END) as sent_count,
                    SUM(CASE WHEN status = 'failed' OR status = 'held_undelivered' THEN 1 ELSE 0 END) as failed_count,
                    SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) as pending_count
                 FROM {$jobs_table} 
                 WHERE campaign_id = %d",
                (int) $job->campaign_id
            ));

            if ($counts) {
                $camp_status = ((int) $counts->pending_count === 0) ? 'done' : 'running';
                $wpdb->update(
                    $campaigns_table,
                    array(
                        'sent'   => (int) $counts->sent_count,
                        'failed' => (int) $counts->failed_count,
                        'status' => $camp_status,
                    ),
                    array('id' => (int) $job->campaign_id)
                );
            }
        }

        // OmniTracker: emet un evenement "whatsapp_sent" (contact reellement atteint).
        // Idempotent par job (payload stable) : sent/delivered/read ne creent qu'UN evenement.
        if (in_array($status, array('sent', 'delivered', 'read'), true)
            && class_exists('DigiWare\WhatsApp\Tracking\OmniTrackerBridge')) {
            $full = $wpdb->get_row($wpdb->prepare(
                "SELECT metadata FROM {$jobs_table} WHERE id = %d",
                (int) $job_id
            ), ARRAY_A);
            $meta = (!empty($full['metadata'])) ? json_decode($full['metadata'], true) : array();
            $dw_token = (is_array($meta) && !empty($meta['dw_job_token']))
                ? $meta['dw_job_token']
                : ('wasender_' . (int) $job_id);
            \DigiWare\WhatsApp\Tracking\OmniTrackerBridge::record_event('whatsapp_sent', array(
                'job_id'       => (int) $job_id,
                'campaign_id'  => $job->campaign_id ? (int) $job->campaign_id : null,
                'phone_hash'   => hash('sha256', (string) $job->phone),
                'dw_job_token' => $dw_token,
            ), array(
                'idempotency_key' => 'wa_sent_' . $dw_token,
            ));
        }

        return (bool) $updated;
    }

    /**
     * Enregistre une réponse entrante et gère automatiquement l'Opt-Out
     *
     * @param string $phone Numéro E.164
     * @param string $message Contenu de la réponse
     * @param string|null $timestamp Horodatage optionnel
     * @return array [ 'is_optout' => bool, 'matched_keyword' => string ]
     */
    public static function record_incoming_reply($phone, $message, $timestamp = null) {
        global $wpdb;
        $replies_table = $wpdb->prefix . 'wasender_replies';

        $clean_phone = WASenderEngine::validateAndFormatPhone($phone) ?: preg_replace('/[^\d+]/', '', $phone);
        $clean_msg   = sanitize_textarea_field($message);
        $time        = $timestamp ? sanitize_text_field($timestamp) : current_time('mysql');

        // Analyse Opt-Out
        $optout_check = WASenderEngine::isOptOut($clean_msg);
        $is_optout = (bool) $optout_check['is_optout'];
        $matched_kw = (string) $optout_check['matched_keyword'];

        $wpdb->insert(
            $replies_table,
            array(
                'phone'           => $clean_phone,
                'message'         => $clean_msg,
                'is_optout'       => $is_optout ? 1 : 0,
                'matched_keyword' => $matched_kw,
                'received_at'     => $time,
            )
        );

        if ($is_optout) {
            self::add_to_blacklist($clean_phone, 'Opt-out automatique (réponse entrante)', $matched_kw);
        } else {
            self::log(null, 'info', "Message entrant reçu de {$clean_phone} : " . substr($clean_msg, 0, 80));
        }

        // Une réponse prouve sans ambiguïté que le message a été LIVRÉ *et* LU
        // (même si la double coche bleue est masquée par la politique de confidentialité
        // du destinataire). On fait donc monter le dernier job envoyé à cet état 'read'.
        // Le format du numéro peut différer entre le job (ex. "21650027157") et la réponse
        // (ex. "+216 50 027 157") : on compare les chiffres bruts, avec repli sur les 9 derniers.
        $jobs_table = $wpdb->prefix . 'wasender_jobs';
        $digits = preg_replace('/\D/', '', $clean_phone);
        $last_job_id = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$jobs_table}
             WHERE status IN ('sent', 'delivered', 'held_undelivered', 'processing')
               AND ( REPLACE(REPLACE(phone, '+', ''), ' ', '') = %s
                     OR RIGHT(REPLACE(REPLACE(phone, '+', ''), ' ', ''), 9) = RIGHT(%s, 9) )
             ORDER BY id DESC
             LIMIT 1",
            $digits, $digits
        ));
        if ($last_job_id) {
            self::update_job_status((int) $last_job_id, 'read', 'Réponse reçue (preuve de lecture)');
        }

        // OmniTracker : la réponse est le signal d'engagement le plus fort côté WhatsApp.
        if (class_exists('DigiWare\WhatsApp\Tracking\OmniTrackerBridge')) {
            $reply_key = 'wa_reply_' . hash('sha256', $clean_phone . '|' . $time . '|' . substr($clean_msg, 0, 40));
            \DigiWare\WhatsApp\Tracking\OmniTrackerBridge::record_event('whatsapp_reply', array(
                'job_id'     => $last_job_id ? (int) $last_job_id : null,
                'phone_hash' => hash('sha256', $clean_phone),
                'is_optout'  => $is_optout,
                'received_at'=> $time,
            ), array(
                'idempotency_key' => $reply_key,
            ));
        }

        return array(
            'is_optout'       => $is_optout,
            'matched_keyword' => $matched_kw,
            'job_upgraded'    => $last_job_id ? (int) $last_job_id : null,
        );
    }

    /**
     * Récupère les compteurs globaux du tableau de bord
     *
     * @return array
     */
    public static function get_status_counts() {
        global $wpdb;
        $jobs_table      = $wpdb->prefix . 'wasender_jobs';
        $blacklist_table = $wpdb->prefix . 'wasender_blacklist';
        $replies_table   = $wpdb->prefix . 'wasender_replies';

        $counts = $wpdb->get_row(
            "SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) as `read`,
                SUM(CASE WHEN status = 'failed' OR status = 'held_undelivered' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'opted_out' THEN 1 ELSE 0 END) as opted_out
             FROM {$jobs_table}",
            ARRAY_A
        );

        $blacklist_count = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$blacklist_table}");
        $replies_count   = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$replies_table}");

        $settings = self::get_all_settings();
        $last_ping = $settings['last_node_ping'];
        $is_connected = false;
        if ($last_ping) {
            $diff = time() - strtotime($last_ping);
            $is_connected = $diff <= 90; // Connecté si ping reçu il y a moins de 90s
        }

        return array(
            'total'           => (int) ($counts['total'] ?? 0),
            'queued'          => (int) ($counts['queued'] ?? 0),
            'processing'      => (int) ($counts['processing'] ?? 0),
            'sent'            => (int) ($counts['sent'] ?? 0),
            'delivered'       => (int) ($counts['delivered'] ?? 0),
            'read'            => (int) ($counts['read'] ?? 0),
            'failed'          => (int) ($counts['failed'] ?? 0),
            'opted_out'       => (int) ($counts['opted_out'] ?? 0),
            'blacklist_count' => $blacklist_count,
            'replies_count'   => $replies_count,
            'queue_paused'    => (bool) $settings['queue_paused'],
            'node_connected'  => $is_connected,
            'last_node_ping'  => $last_ping,
        );
    }
}
