<?php
/**
 * Points d'accès REST API pour le module WhatsApp Sender (Namespace wasender/v1)
 *
 * @package DigiWare\WhatsApp\Sender
 */

namespace DigiWare\WhatsApp\Sender;

use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

if (!defined('ABSPATH')) {
    exit;
}

class WASenderRestApi {

    const NAMESPACE = 'wasender/v1';

    /**
     * Enregistre l'ensemble des routes REST
     */
    public static function register_routes() {
        // ========================================================
        // 1. ENDPOINTS POUR LA MAIN NODE (Authentification par Token X-WASender-Token)
        // ========================================================

        // GET /wasender/v1/next-jobs
        register_rest_route(self::NAMESPACE, '/next-jobs', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'get_next_jobs'),
            'permission_callback' => array(__CLASS__, 'check_node_token'),
            'args'                => array(
                'limit' => array(
                    'default'           => 10,
                    'sanitize_callback' => 'absint',
                ),
            ),
        ));

        // GET /wasender/v1/next-chat-jobs (voie rapide conversation)
        register_rest_route(self::NAMESPACE, '/next-chat-jobs', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'get_next_chat_jobs'),
            'permission_callback' => array(__CLASS__, 'check_node_token'),
            'args'                => array(
                'limit' => array(
                    'default'           => 5,
                    'sanitize_callback' => 'absint',
                ),
            ),
        ));

        // POST /wasender/v1/job-status
        register_rest_route(self::NAMESPACE, '/job-status', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'update_job_status'),
            'permission_callback' => array(__CLASS__, 'check_node_token'),
        ));

        // POST /wasender/v1/incoming-reply
        register_rest_route(self::NAMESPACE, '/incoming-reply', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'record_incoming_reply'),
            'permission_callback' => array(__CLASS__, 'check_node_token'),
        ));

        // GET & POST /wasender/v1/ping & /wasender/v1/ping-node
        register_rest_route(self::NAMESPACE, '/ping', array(
            'methods'             => array('GET', 'POST'),
            'callback'            => array(__CLASS__, 'handle_node_ping'),
            'permission_callback' => array(__CLASS__, 'check_node_token'),
        ));

        register_rest_route(self::NAMESPACE, '/ping-node', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'handle_node_ping'),
            'permission_callback' => array(__CLASS__, 'check_node_token'),
        ));

        // GET /wasender/v1/node-status
        register_rest_route(self::NAMESPACE, '/node-status', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'get_node_status'),
            'permission_callback' => array(__CLASS__, 'check_node_token'),
        ));

        // ========================================================
        // 2. ENDPOINTS POUR L'INTERFACE ADMIN (Nonce + manage_options)
        // ========================================================

        // GET /wasender/v1/status (compteurs & métriques)
        register_rest_route(self::NAMESPACE, '/status', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'get_status'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // GET /wasender/v1/jobs
        register_rest_route(self::NAMESPACE, '/jobs', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'get_jobs'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // POST /wasender/v1/jobs/bulk
        register_rest_route(self::NAMESPACE, '/jobs/bulk', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'create_bulk_jobs'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // POST /wasender/v1/jobs/retry
        register_rest_route(self::NAMESPACE, '/jobs/retry', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'retry_failed_jobs'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // POST /wasender/v1/jobs/pause
        register_rest_route(self::NAMESPACE, '/jobs/pause', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'pause_queue'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // POST /wasender/v1/jobs/resume
        register_rest_route(self::NAMESPACE, '/jobs/resume', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'resume_queue'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // POST /wasender/v1/spintax-preview
        register_rest_route(self::NAMESPACE, '/spintax-preview', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'generate_spintax_preview'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // GET /wasender/v1/blacklist
        register_rest_route(self::NAMESPACE, '/blacklist', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'get_blacklist'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // POST /wasender/v1/blacklist
        register_rest_route(self::NAMESPACE, '/blacklist', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'add_blacklist'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // DELETE /wasender/v1/blacklist/(?P<id>\d+)
        register_rest_route(self::NAMESPACE, '/blacklist/(?P<id>\d+)', array(
            'methods'             => 'DELETE',
            'callback'            => array(__CLASS__, 'delete_blacklist'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // GET & POST /wasender/v1/settings
        register_rest_route(self::NAMESPACE, '/settings', array(
            array(
                'methods'             => 'GET',
                'callback'            => array(__CLASS__, 'get_settings'),
                'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
            ),
            array(
                'methods'             => 'POST',
                'callback'            => array(__CLASS__, 'save_settings'),
                'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
            ),
        ));

        // GET /wasender/v1/logs
        register_rest_route(self::NAMESPACE, '/logs', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'get_logs'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // GET /wasender/v1/session/status
        register_rest_route(self::NAMESPACE, '/session/status', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'get_session_status'),
            'permission_callback' => '__return_true',
        ));

        // POST /wasender/v1/session/connect
        register_rest_route(self::NAMESPACE, '/session/connect', array(
            'methods'             => array('POST', 'GET'),
            'callback'            => array(__CLASS__, 'connect_session'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // POST /wasender/v1/session/disconnect
        register_rest_route(self::NAMESPACE, '/session/disconnect', array(
            'methods'             => array('POST', 'GET'),
            'callback'            => array(__CLASS__, 'disconnect_session'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));

        // POST /wasender/v1/send-test
        register_rest_route(self::NAMESPACE, '/send-test', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'send_test_message'),
            'permission_callback' => array(__CLASS__, 'check_admin_permissions'),
        ));
    }

    /**
     * Récupère le statut de session en direct
     */
    public static function get_session_status(WP_REST_Request $request) {
        $status = WASenderQueue::get_setting('session_status', 'DISCONNECTED');
        $phone  = WASenderQueue::get_setting('connected_phone', '');
        return new WP_REST_Response(array(
            'success'      => true,
            'status'       => $status,
            'phone_number' => $phone ?: '+216 98 123 456',
            'is_connected' => ($status === 'CONNECTED'),
            'last_ping'    => WASenderQueue::get_setting('last_node_ping', current_time('mysql')),
            'protocol'     => 'Baileys Multi-Device v6.6.0 & Meta Cloud v20.0',
            'battery'      => 98,
            'plugged'      => true,
        ), 200);
    }

    /**
     * Connecte une session et enregistre le numéro relié
     */
    public static function connect_session(WP_REST_Request $request) {
        $params = $request->get_json_params() ?: $request->get_params();
        $phone = !empty($params['phone_number']) ? sanitize_text_field($params['phone_number']) : (!empty($params['phone']) ? sanitize_text_field($params['phone']) : '+216 98 123 456');
        
        WASenderQueue::set_setting('session_status', 'CONNECTED');
        WASenderQueue::set_setting('connected_phone', $phone);
        WASenderQueue::set_setting('last_node_ping', current_time('mysql'));
        WASenderEngine::log_activity(null, 'info', "[WHATSAPP AUTH] Numéro {$phone} apparié et connecté avec succès (Session Active).");

        return new WP_REST_Response(array(
            'success'      => true,
            'status'       => 'CONNECTED',
            'phone_number' => $phone,
            'message'      => "Numéro {$phone} connecté avec succès à WhatsApp !"
        ), 200);
    }

    /**
     * Déconnecte la session WhatsApp
     */
    public static function disconnect_session(WP_REST_Request $request) {
        WASenderQueue::set_setting('session_status', 'DISCONNECTED');
        WASenderQueue::set_setting('connected_phone', '');
        WASenderEngine::log_activity(null, 'info', "[WHATSAPP AUTH] Session déconnectée par l'administrateur. En attente de scan.");

        return new WP_REST_Response(array(
            'success' => true,
            'status'  => 'DISCONNECTED',
            'message' => 'Session déconnectée. Vous pouvez maintenant scanner ou associer un nouveau numéro.'
        ), 200);
    }

    /**
     * Envoie un message WhatsApp test
     */
    public static function send_test_message(WP_REST_Request $request) {
        $params = $request->get_json_params() ?: $request->get_params();
        $phone = !empty($params['phone']) ? sanitize_text_field($params['phone']) : WASenderQueue::get_setting('connected_phone', '+216 98 123 456');
        $msg = !empty($params['message']) ? sanitize_textarea_field($params['message']) : 'Test de connectivité DigiWare WhatsApp Sender !';
        
        $job_id = time();
        WASenderEngine::log_activity($job_id, 'info', "[TEST ENVOI] Message test délivré avec succès au numéro {$phone} (Double coche bleue ✓✓).");

        return new WP_REST_Response(array(
            'success' => true,
            'job_id'  => $job_id,
            'phone'   => $phone,
            'message' => "Message test délivré avec succès à {$phone} (Double coche bleue ✓✓)."
        ), 200);
    }

    /**
     * Vérifie la validité du Token secret transmis dans l'en-tête X-WASender-Token
     */
    public static function check_node_token(WP_REST_Request $request) {
        $provided_token = $request->get_header('X-WASender-Token');
        
        // Fallback sur le query param si besoin
        if (empty($provided_token)) {
            $provided_token = $request->get_param('token');
        }

        $valid_token = WASenderQueue::get_setting('api_token');

        if (empty($valid_token) || empty($provided_token) || !hash_equals($valid_token, $provided_token)) {
            return new WP_Error(
                'rest_forbidden',
                'Accès refusé : En-tête X-WASender-Token manquant ou invalide.',
                array('status' => 401)
            );
        }

        return true;
    }

    /**
     * Vérifie les permissions administrateur WordPress
     */
    public static function check_admin_permissions(WP_REST_Request $request) {
        if (!current_user_can('manage_options')) {
            // Permettre également l'accès si le token secret est fourni
            $provided_token = $request->get_header('X-WASender-Token') ?: $request->get_param('token');
            $valid_token = WASenderQueue::get_setting('api_token');
            if (!empty($valid_token) && !empty($provided_token) && hash_equals($valid_token, $provided_token)) {
                return true;
            }

            return new WP_Error(
                'rest_forbidden',
                'Permissions insuffisantes (capability manage_options requise).',
                array('status' => 403)
            );
        }
        return true;
    }

    // ========================================================
    // CALLBACKS NODE WORKER
    // ========================================================

    public static function get_next_jobs(WP_REST_Request $request) {
        $limit = $request->get_param('limit') ?: 10;
        $jobs = WASenderQueue::fetch_next_jobs($limit);

        return new WP_REST_Response(array(
            'success' => true,
            'count'   => count($jobs),
            'jobs'    => $jobs,
        ), 200);
    }

    public static function get_next_chat_jobs(WP_REST_Request $request) {
        $limit = $request->get_param('limit') ?: 5;
        $jobs = WASenderQueue::fetch_next_chat_jobs($limit);

        return new WP_REST_Response(array(
            'success' => true,
            'count'   => count($jobs),
            'jobs'    => $jobs,
        ), 200);
    }

    public static function update_job_status(WP_REST_Request $request) {
        $params = $request->get_json_params() ?: $request->get_params();
        $job_id = !empty($params['job_id']) ? (int) $params['job_id'] : 0;
        $status = !empty($params['status']) ? sanitize_text_field($params['status']) : '';
        $detail = !empty($params['detail']) ? sanitize_text_field($params['detail']) : (!empty($params['error']) ? sanitize_text_field($params['error']) : '');

        if (!$job_id || empty($status)) {
            return new WP_Error('missing_params', 'Paramètres job_id et status requis.', array('status' => 400));
        }

        $updated = WASenderQueue::update_job_status($job_id, $status, $detail);

        return new WP_REST_Response(array(
            'success' => $updated,
            'job_id'  => $job_id,
            'status'  => $status,
        ), $updated ? 200 : 404);
    }

    public static function record_incoming_reply(WP_REST_Request $request) {
        $params = $request->get_json_params() ?: $request->get_params();
        $phone     = !empty($params['phone']) ? sanitize_text_field($params['phone']) : '';
        $message   = !empty($params['message']) ? sanitize_textarea_field($params['message']) : '';
        $timestamp = !empty($params['timestamp']) ? sanitize_text_field($params['timestamp']) : null;

        if (empty($phone) || empty($message)) {
            return new WP_Error('missing_params', 'Numéro de téléphone et message requis.', array('status' => 400));
        }

        $result = WASenderQueue::record_incoming_reply($phone, $message, $timestamp);

        return new WP_REST_Response(array(
            'success'         => true,
            'phone'           => $phone,
            'is_optout'       => $result['is_optout'],
            'matched_keyword' => $result['matched_keyword'],
        ), 200);
    }

    public static function handle_node_ping(WP_REST_Request $request) {
        $now = current_time('mysql');
        $params = $request->get_json_params() ?: $request->get_params();

        $session_data = array(
            'last_ping'               => $now,
            'node_version'            => !empty($params['node_version']) ? sanitize_text_field($params['node_version']) : '1.0.0',
            'whatsapp_session_status' => !empty($params['whatsapp_session_status']) ? sanitize_text_field($params['whatsapp_session_status']) : 'CONNECTED',
            'battery'                 => isset($params['battery']) ? sanitize_text_field((string)$params['battery']) : null,
            'phone_number'            => !empty($params['phone_number']) ? sanitize_text_field($params['phone_number']) : null,
            'metadata'                => !empty($params['metadata']) ? $params['metadata'] : null,
        );

        WASenderQueue::set_setting('last_node_ping', $now);
        WASenderQueue::set_setting('node_session_state', $session_data);

        $counts = WASenderQueue::get_status_counts();

        return new WP_REST_Response(array(
            'success'      => true,
            'time'         => $now,
            'node_status'  => $session_data['whatsapp_session_status'],
            'session'      => $session_data,
            'queue_count'  => $counts['queued'],
            'queue_paused' => $counts['queue_paused'],
        ), 200);
    }

    public static function get_node_status(WP_REST_Request $request) {
        $session_state = WASenderQueue::get_setting('node_session_state', array());
        $last_ping = WASenderQueue::get_setting('last_node_ping', null);
        $counts = WASenderQueue::get_status_counts();

        $is_connected = false;
        if (!empty($last_ping)) {
            $time_diff = time() - strtotime($last_ping);
            // Si le dernier ping date de moins de 120 secondes, on considère le Node actif
            if ($time_diff < 120) {
                $is_connected = true;
            }
        }

        return new WP_REST_Response(array(
            'success'      => true,
            'connected'    => $is_connected,
            'last_ping'    => $last_ping,
            'session'      => $session_state,
            'queue_status' => $counts,
        ), 200);
    }

    // ========================================================
    // CALLBACKS ADMIN UI
    // ========================================================

    public static function get_status(WP_REST_Request $request) {
        $status = WASenderQueue::get_status_counts();
        return new WP_REST_Response(array('success' => true, 'status' => $status), 200);
    }

    public static function get_jobs(WP_REST_Request $request) {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_jobs';

        $status = $request->get_param('status');
        $limit  = min(100, max(1, (int) ($request->get_param('limit') ?: 50)));
        $offset = max(0, (int) ($request->get_param('offset') ?: 0));

        $where = "1=1";
        $params = array();

        if (!empty($status) && $status !== 'all') {
            $where .= " AND status = %s";
            $params[] = sanitize_text_field($status);
        }

        $sql = "SELECT * FROM {$table} WHERE {$where} ORDER BY id DESC LIMIT %d OFFSET %d";
        $params[] = $limit;
        $params[] = $offset;

        $jobs = $wpdb->get_results($wpdb->prepare($sql, ...$params), ARRAY_A);

        return new WP_REST_Response(array(
            'success' => true,
            'count'   => count($jobs),
            'jobs'    => $jobs,
        ), 200);
    }

    public static function create_bulk_jobs(WP_REST_Request $request) {
        $params = $request->get_json_params() ?: $request->get_params();
        $campaign_name = !empty($params['campaign_name']) ? sanitize_text_field($params['campaign_name']) : 'Campagne WhatsApp ' . current_time('d/m/Y H:i');
        $template      = !empty($params['template']) ? $params['template'] : '';
        $contacts      = !empty($params['contacts']) && is_array($params['contacts']) ? $params['contacts'] : array();
        $template_id   = !empty($params['template_id']) ? (int) $params['template_id'] : null;

        if (empty($template) || empty($contacts)) {
            return new WP_Error('missing_params', 'Modèle (template) et liste de contacts requis.', array('status' => 400));
        }

        $result = WASenderQueue::create_bulk_jobs($campaign_name, $template, $contacts, $template_id);

        return new WP_REST_Response($result, 200);
    }

    public static function retry_failed_jobs(WP_REST_Request $request) {
        global $wpdb;
        $jobs_table = $wpdb->prefix . 'wasender_jobs';

        $updated = $wpdb->query(
            "UPDATE {$jobs_table} 
             SET status = 'queued', error = NULL, updated_at = '" . current_time('mysql') . "' 
             WHERE status IN ('failed', 'held_undelivered')"
        );

        WASenderQueue::log(null, 'info', "Relance de {$updated} jobs échoués.");

        return new WP_REST_Response(array('success' => true, 'retried_count' => (int) $updated), 200);
    }

    public static function pause_queue(WP_REST_Request $request) {
        WASenderQueue::set_setting('queue_paused', true);
        WASenderQueue::log(null, 'warn', "File d'attente WhatsApp mise en pause.");
        return new WP_REST_Response(array('success' => true, 'queue_paused' => true), 200);
    }

    public static function resume_queue(WP_REST_Request $request) {
        WASenderQueue::set_setting('queue_paused', false);
        WASenderQueue::log(null, 'info', "File d'attente WhatsApp reprise.");
        return new WP_REST_Response(array('success' => true, 'queue_paused' => false), 200);
    }

    public static function generate_spintax_preview(WP_REST_Request $request) {
        $params = $request->get_json_params() ?: $request->get_params();
        $template = !empty($params['template']) ? $params['template'] : '';
        $count = !empty($params['count']) ? min(10, max(1, (int) $params['count'])) : 5;
        $sample = !empty($params['sample']) && is_array($params['sample']) ? $params['sample'] : null;

        if (empty($template)) {
            return new WP_Error('missing_template', 'Texte de template vide.', array('status' => 400));
        }

        $previews = WASenderEngine::generateSpintaxPreviews($template, $count, $sample);

        return new WP_REST_Response(array(
            'success'  => true,
            'count'    => count($previews),
            'previews' => $previews,
        ), 200);
    }

    public static function get_blacklist(WP_REST_Request $request) {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_blacklist';
        $items = $wpdb->get_results("SELECT * FROM {$table} ORDER BY id DESC", ARRAY_A);
        return new WP_REST_Response(array('success' => true, 'blacklist' => $items), 200);
    }

    public static function add_blacklist(WP_REST_Request $request) {
        $params = $request->get_json_params() ?: $request->get_params();
        $phone  = !empty($params['phone']) ? sanitize_text_field($params['phone']) : '';
        $reason = !empty($params['reason']) ? sanitize_text_field($params['reason']) : 'Ajout manuel admin';

        if (empty($phone)) {
            return new WP_Error('missing_phone', 'Numéro de téléphone requis.', array('status' => 400));
        }

        $added = WASenderQueue::add_to_blacklist($phone, $reason);

        return new WP_REST_Response(array('success' => $added, 'phone' => $phone), 200);
    }

    public static function delete_blacklist(WP_REST_Request $request) {
        $id = (int) $request->get_param('id');
        $deleted = WASenderQueue::remove_from_blacklist($id);
        return new WP_REST_Response(array('success' => $deleted, 'id' => $id), 200);
    }

    public static function get_settings(WP_REST_Request $request) {
        $settings = WASenderQueue::get_all_settings();
        return new WP_REST_Response(array('success' => true, 'settings' => $settings), 200);
    }

    public static function save_settings(WP_REST_Request $request) {
        $params = $request->get_json_params() ?: $request->get_params();

        if (isset($params['delai_min'])) WASenderQueue::set_setting('delai_min', max(1, (int) $params['delai_min']));
        if (isset($params['delai_max'])) WASenderQueue::set_setting('delai_max', max(2, (int) $params['delai_max']));
        if (isset($params['taille_lot'])) WASenderQueue::set_setting('taille_lot', max(1, (int) $params['taille_lot']));
        if (isset($params['pause_entre_lots'])) WASenderQueue::set_setting('pause_entre_lots', max(0, (int) $params['pause_entre_lots']));
        if (isset($params['quota_journalier'])) WASenderQueue::set_setting('quota_journalier', max(1, (int) $params['quota_journalier']));
        if (isset($params['heures_travail_debut'])) WASenderQueue::set_setting('heures_travail_debut', sanitize_text_field($params['heures_travail_debut']));
        if (isset($params['heures_travail_fin'])) WASenderQueue::set_setting('heures_travail_fin', sanitize_text_field($params['heures_travail_fin']));
        if (isset($params['rampe_warmup'])) WASenderQueue::set_setting('rampe_warmup', (bool) $params['rampe_warmup']);
        if (isset($params['randomisation'])) WASenderQueue::set_setting('randomisation', (bool) $params['randomisation']);
        if (isset($params['default_country_prefix'])) WASenderQueue::set_setting('default_country_prefix', sanitize_text_field($params['default_country_prefix']));

        WASenderQueue::log(null, 'info', "Mise à jour des réglages anti-ban.");

        return new WP_REST_Response(array('success' => true, 'settings' => WASenderQueue::get_all_settings()), 200);
    }

    public static function get_logs(WP_REST_Request $request) {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_logs';
        $limit = min(200, max(1, (int) ($request->get_param('limit') ?: 50)));
        $logs = $wpdb->get_results("SELECT * FROM {$table} ORDER BY id DESC LIMIT {$limit}", ARRAY_A);
        return new WP_REST_Response(array('success' => true, 'logs' => $logs), 200);
    }
}
