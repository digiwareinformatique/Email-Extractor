<?php
/**
 * Administration Interface for DigiWare WhatsApp Business Center
 *
 * @package DigiWare\WhatsApp\WordPress
 */

namespace DigiWare\WhatsApp\WordPress;

use DigiWare\WhatsApp\Core\Normalizer;
use DigiWare\WhatsApp\Preparation\TemplateManager;
use DigiWare\WhatsApp\Preparation\CrmConnector;
use DigiWare\WhatsApp\Preparation\MessagePreparator;
use DigiWare\WhatsApp\Sender\WhatsAppSenderAdapter;
use DigiWare\WhatsApp\Tracking\OmniTrackerBridge;
use DigiWare\WhatsApp\Tracking\LinkTracker;

if (!defined('ABSPATH')) {
    exit;
}

class Admin {

    /**
     * Initialize admin hooks
     */
    public static function init() {
        add_action('admin_menu', array(__CLASS__, 'register_menu'));
        add_action('admin_enqueue_scripts', array(__CLASS__, 'enqueue_styles'));
        add_action('admin_init', array(__CLASS__, 'handle_actions'));
        // Conversation temps réel : rafraîchissement en arrière-plan (comme WhatsApp Web)
        add_action('wp_ajax_dw_conv_poll', array(__CLASS__, 'ajax_conv_poll'));
        add_action('wp_ajax_dw_conv_send', array(__CLASS__, 'ajax_conv_send'));
        // Campagnes : calcul RÉEL de l'audience éligible (compteur en direct dans l'assistant).
        add_action('wp_ajax_dw_bc_audience', array(__CLASS__, 'ajax_bc_audience'));
        // Templates : aperçu personnalisé RÉEL (résout via le même moteur que le Sender).
        add_action('wp_ajax_dw_tpl_preview', array(__CLASS__, 'ajax_tpl_preview'));
    }

    /**
     * AJAX : renvoie l'état courant d'une conversation + la liste + les KPI.
     * Utilisé par le poller front pour actualiser sans recharger la page.
     */
    public static function ajax_conv_poll() {
        if (!current_user_can('manage_options')) { wp_send_json_error('forbidden', 403); }
        check_ajax_referer('dw_conv_ajax', 'nonce');
        global $wpdb;
        $jobs_table    = $wpdb->prefix . 'wasender_jobs';
        $replies_table = $wpdb->prefix . 'wasender_replies';
        $active = isset($_GET['phone']) ? preg_replace('/[^0-9]/', '', $_GET['phone']) : '';

        // Liste des conversations (même requête normalisée que le rendu serveur)
        $rows = $wpdb->get_results(
            "SELECT MAX(phone) AS phone, MAX(t) AS last_at, SUM(inbound) AS in_count,
                    SUBSTRING_INDEX(GROUP_CONCAT(last_body ORDER BY t DESC SEPARATOR '\\n\\n'), '\\n\\n', 1) AS last_body
             FROM (
                SELECT REPLACE(REPLACE(phone,'+',''),' ','') AS norm, phone, COALESCE(sent_at, created_at, updated_at) AS t, 0 AS inbound, message_final AS last_body FROM {$jobs_table}
                UNION ALL
                SELECT REPLACE(REPLACE(phone,'+',''),' ','') AS norm, phone, received_at AS t, 1 AS inbound, message AS last_body FROM {$replies_table}
             ) u GROUP BY norm ORDER BY last_at DESC LIMIT 100",
            ARRAY_A
        );
        $list = array();
        $unread = 0;
        foreach ($rows as $r) {
            $digits = preg_replace('/[^0-9]/', '', $r['phone']);
            $in_count = (int) $r['in_count'];
            if ($in_count > 0) { $unread++; }
            $list[] = array(
                'digits'   => $digits,
                'phone'    => (string) $r['phone'],
                'in_count' => $in_count,
                'snippet'  => mb_substr((string) $r['last_body'], 0, 60),
                'time'     => self::fmt_time($r['last_at'], 'd/m H:i'),
                'ts'       => (int) strtotime($r['last_at']),
            );
        }

        // Fil actif
        $thread = array();
        if ($active !== '') {
            $t = $wpdb->get_results($wpdb->prepare(
                "SELECT dir, body, st, at, created, sent FROM (
                    SELECT 'out' AS dir, message_final AS body, status AS st, COALESCE(sent_at, created_at, updated_at) AS at, created_at AS created, sent_at AS sent FROM {$jobs_table} WHERE REPLACE(REPLACE(phone,'+',''),' ','') = %s
                    UNION ALL
                    SELECT 'in' AS dir, message AS body, CASE WHEN is_optout=1 THEN 'opt-out' ELSE 'recu' END AS st, received_at AS at, received_at AS created, NULL AS sent FROM {$replies_table} WHERE REPLACE(REPLACE(phone,'+',''),' ','') = %s
                 ) t ORDER BY at ASC",
                $active, $active
            ), ARRAY_A);
            foreach ($t as $m) {
                $thread[] = array(
                    'dir'     => (string) $m['dir'],
                    'body'    => (string) $m['body'],
                    'st'      => (string) $m['st'],
                    'h'       => self::fmt_time($m['at'], 'H:i'),
                    'd'       => self::fmt_time($m['at'], 'j F Y'),
                    'at'      => (string) $m['at'],
                    'created' => (string) $m['created'],
                    'sent'    => $m['sent'] !== null ? (string) $m['sent'] : '',
                );
            }
        }

        $counts = array(
            'convos'  => count($rows),
            'unread'  => $unread,
            'replies' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$replies_table}"),
            'sent'    => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$jobs_table} WHERE status IN ('sent','delivered','read')"),
            'pending' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$jobs_table} WHERE status IN ('queued','processing','held_undelivered')"),
        );

        wp_send_json_success(array('thread' => $thread, 'list' => $list, 'counts' => $counts, 'active' => $active));
    }

    /**
     * AJAX : envoie une réponse dans la conversation (voie rapide instantanée)
     * sans recharger la page. Renvoie le job créé.
     */
    public static function ajax_conv_send() {
        if (!current_user_can('manage_options')) { wp_send_json_error('forbidden', 403); }
        check_ajax_referer('dw_conv_ajax', 'nonce');
        $phone   = isset($_POST['phone']) ? sanitize_text_field(wp_unslash($_POST['phone'])) : '';
        $message = isset($_POST['message']) ? trim((string) wp_unslash($_POST['message'])) : '';
        if ($phone === '' || $message === '') { wp_send_json_error('empty', 400); }
        if (!class_exists('\\DigiWare\\WhatsApp\\Sender\\WASenderQueue')) { wp_send_json_error('no_queue', 500); }
        $res = \DigiWare\WhatsApp\Sender\WASenderQueue::create_chat_message($phone, $message);
        if (!empty($res['success'])) {
            wp_send_json_success(array('job_id' => (int) $res['job_id'], 'phone' => (string) $res['phone']));
        }
        wp_send_json_error(isset($res['error']) ? $res['error'] : 'queue_failed', 500);
    }

    /**
     * Référence de temps STANDARD de l'interface.
     *
     * Tous les horodatages sont stockés en UTC (WordPress gmt_offset=0, MySQL en UTC,
     * la « main » Node envoie du ISO-8601 UTC). Peu importe la source du message
     * (téléphone, WhatsApp Web, extension), on les convertit TOUS vers l'heure de
     * Tunisie (Africa/Tunis) pour l'affichage — comme l'heure affichée sur le téléphone.
     * L'ordre chronologique reste calculé sur l'UTC brut (référence unique).
     *
     * @param string $mysql_utc Horodatage MySQL supposé en UTC
     * @param string $fmt        Format date() (localisé en français)
     * @return string
     */
    private static function fmt_time($mysql_utc, $fmt) {
        if (empty($mysql_utc) || substr((string) $mysql_utc, 0, 4) === '0000') {
            return '';
        }
        try {
            $dt  = new \DateTime((string) $mysql_utc, new \DateTimeZone('UTC'));
            $off = (new \DateTimeZone('Africa/Tunis'))->getOffset($dt); // +1h (pas de DST en Tunisie)
            return date_i18n($fmt, $dt->getTimestamp() + $off, true);
        } catch (\Exception $e) {
            return (string) $mysql_utc;
        }
    }

    /**
     * Register admin menu
     */
    public static function register_menu() {
        add_menu_page(
            __('WhatsApp Center', 'digiware-whatsapp'),
            __('WhatsApp Center', 'digiware-whatsapp'),
            'manage_options',
            'digiware-whatsapp',
            array(__CLASS__, 'render_page'),
            'dashicons-whatsapp',
            30
        );
    }

    /**
     * Enqueue styling for modern admin interface
     */
    public static function enqueue_styles($hook) {
        if (strpos($hook, 'digiware-whatsapp') === false) {
            return;
        }

        wp_register_style('dw-whatsapp-admin-style', false);
        wp_enqueue_style('dw-whatsapp-admin-style');
        wp_add_inline_style('dw-whatsapp-admin-style', '
            .dw-wrap { max-width: 1380px; margin: 25px 20px 20px 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
            .dw-header { background: linear-gradient(135deg, #09131f 0%, #064e3b 100%); color: #fff; padding: 24px 32px; border-radius: 16px; margin-bottom: 24px; box-shadow: 0 10px 25px -5px rgba(6, 78, 59, 0.3); display: flex; align-items: center; justify-content: space-between; }
            .dw-title { font-size: 22px; font-weight: 800; margin: 0 0 6px 0; display: flex; align-items: center; gap: 12px; color: #fff; }
            .dw-badge-online { background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.5); color: #4ade80; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; gap: 6px; }
            .dw-badge-offline { background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.5); color: #f87171; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; }
            .dw-nav-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 2px; }
            .dw-tab-link { text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: 8px 8px 0 0; color: #64748b; background: transparent; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }
            .dw-tab-link:hover { color: #0f172a; background: #f1f5f9; }
            .dw-tab-link.active { color: #065f46; background: #fff; border-bottom: 3px solid #10b981; font-weight: 700; }
            .dw-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow-x: auto; }
            .dw-chat-container { display: grid; grid-template-columns: 300px minmax(0,1fr) 320px; gap: 16px; height: 680px; max-width: 100%; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
            .dw-chat-list { border-right: 1px solid #e2e8f0; overflow-y: auto; min-width: 0; background: #f8fafc; }
            .dw-chat-main { display: flex; flex-direction: column; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: #f7faf8; }
            .dw-chat-messages { flex: 1 1 auto; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; background: #fafafa; }
            .dw-msg-bubble { max-width: 75%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.4; word-break: break-word; }
            .dw-msg-inbound { align-self: flex-start; background: #fff; border: 1px solid #e2e8f0; color: #1e293b; border-bottom-left-radius: 2px; }
            .dw-msg-outbound { align-self: flex-end; background: #dcf8c6; border: 1px solid #bbf7d0; color: #064e3b; border-bottom-right-radius: 2px; }
            .dw-chat-input-area { flex: 0 0 auto; padding: 16px; background: #fff; border-top: 1px solid #e2e8f0; }
            .dw-chat-crm { border-left: 1px solid #e2e8f0; padding: 20px; overflow-y: auto; min-width: 0; background: #f8fafc; font-size: 13px; }
            /* --- Bloc 2 : fiche contact (colonne de droite) --- */
            .dw-crm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
            .dw-crm-title { font-size: 14px; font-weight: 800; color: #0f172a; }
            .dw-crm-editbtn { font-size: 12px; color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 5px 10px; cursor: pointer; font-weight: 600; display: inline-flex; gap: 5px; align-items: center; }
            .dw-crm-avatar-wrap { text-align: center; padding: 14px 0 6px; }
            .dw-crm-avatar { width: 72px; height: 72px; border-radius: 50%; background: linear-gradient(135deg,#10b981,#059669); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 800; margin: 0 auto 10px; box-shadow: 0 6px 14px -4px rgba(5,150,105,0.5); }
            .dw-crm-phone { font-size: 16px; font-weight: 800; color: #0f172a; font-family: monospace; }
            .dw-crm-online { font-size: 12px; color: #059669; margin-top: 3px; display: flex; align-items: center; justify-content: center; gap: 5px; }
            .dw-crm-actions { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; margin: 16px 0 6px; }
            .dw-crm-action { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 4px; text-align: center; font-size: 11px; color: #475569; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; font-weight: 600; transition: all .15s; }
            .dw-crm-action:hover { border-color: #10b981; color: #059669; background: #f0fdf4; }
            .dw-crm-action svg { width: 18px; height: 18px; }
            .dw-crm-section-title { font-size: 12px; font-weight: 800; color: #0f172a; margin: 18px 0 8px; }
            .dw-crm-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #eef2f7; font-size: 12px; }
            .dw-crm-row:last-child { border-bottom: none; }
            .dw-crm-key { color: #94a3b8; font-weight: 600; flex: 0 0 auto; }
            .dw-crm-val { color: #0f172a; font-weight: 600; text-align: right; font-family: monospace; min-width: 0; word-break: break-word; }
            .dw-crm-pill { background: #eef2ff; color: #4338ca; border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 700; font-family: inherit; }
            .dw-crm-pill-green { background: #dcfce7; color: #166534; }
            .dw-crm-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
            .dw-crm-tag { background: #eef2ff; color: #4338ca; border-radius: 8px; padding: 4px 10px; font-size: 11px; font-weight: 700; }
            .dw-crm-addbtn { font-size: 11px; color: #059669; background: none; border: 1px dashed #a7f3d0; border-radius: 8px; padding: 4px 10px; cursor: pointer; font-weight: 600; }
            .dw-crm-empty { color: #94a3b8; font-size: 12px; font-style: italic; padding: 6px 0; }
            /* --- Fiche contextuelle CRM enrichie (colonne de droite) --- */
            .dw-crm-head-btns { display: flex; gap: 6px; align-items: center; }
            .dw-crm-menu { text-decoration: none; font-size: 15px; line-height: 1; color: #64748b; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 9px; font-weight: 700; }
            .dw-crm-menu:hover { border-color: #10b981; color: #059669; }
            .dw-crm-name { font-size: 15px; font-weight: 800; color: #0f172a; margin-top: 2px; word-break: break-word; }
            .dw-crm-phone-sub { font-size: 12px; color: #64748b; font-family: monospace; margin-top: 2px; }
            .dw-crm-note { font-size: 11px; color: #94a3b8; font-style: italic; line-height: 1.4; margin: 6px 0 2px; }
            .dw-crm-linkbtn { display: inline-block; font-size: 11.5px; color: #059669; font-weight: 600; text-decoration: none; margin: 8px 0 2px; }
            .dw-crm-linkbtn:hover { text-decoration: underline; }
            .dw-crm-field { margin: 8px 0 4px; }
            .dw-crm-flabel { display: block; font-size: 11px; color: #94a3b8; font-weight: 600; margin-bottom: 4px; }
            .dw-crm-select { width: 100%; padding: 7px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; color: #475569; background: #f1f5f9; cursor: not-allowed; }
            .dw-crm-prod { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid #eef2f7; font-size: 12px; }
            .dw-crm-prod:last-of-type { border-bottom: none; }
            .dw-crm-prod-name { color: #0f172a; font-weight: 600; min-width: 0; word-break: break-word; }
            .dw-crm-prod-qty { color: #64748b; font-weight: 700; flex: 0 0 auto; }
            .dw-crm-order { display: block; text-decoration: none; border: 1px solid #e2e8f0; border-radius: 10px; padding: 9px 11px; margin-bottom: 7px; background: #fff; }
            .dw-crm-order:hover { border-color: #10b981; background: #f0fdf4; }
            .dw-crm-order-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
            .dw-crm-order-num { font-size: 12.5px; font-weight: 800; color: #0f172a; font-family: monospace; }
            .dw-crm-order-sub { font-size: 11.5px; color: #64748b; margin-top: 4px; word-break: break-word; }
            .dw-crm-act-stats { font-size: 11.5px; color: #475569; font-weight: 600; margin-bottom: 8px; }
            .dw-crm-act { display: flex; align-items: baseline; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
            .dw-crm-act:last-of-type { border-bottom: none; }
            .dw-crm-act-ic { flex: 0 0 auto; font-size: 13px; }
            .dw-crm-act-tx { flex: 1; color: #334155; min-width: 0; }
            .dw-crm-act-wh { flex: 0 0 auto; font-size: 10.5px; color: #94a3b8; white-space: nowrap; }
            .dw-crm-notes { width: 100%; padding: 9px 11px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; font-family: inherit; resize: vertical; background: #f1f5f9; color: #475569; cursor: not-allowed; }
            .dw-crm-savebtn { margin-top: 7px; padding: 7px 14px; border-radius: 8px; border: 1px solid #e2e8f0; background: #f1f5f9; color: #94a3b8; font-size: 12px; font-weight: 700; cursor: not-allowed; }
            /* --- Bloc 3 : colonne de gauche (recherche + filtres + liste) --- */
            .dw-conv-search { padding: 12px; border-bottom: 1px solid #e2e8f0; background: #fff; display: flex; gap: 8px; align-items: center; }
            .dw-conv-search-box { flex: 1; display: flex; align-items: center; gap: 8px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 12px; }
            .dw-conv-search-box input { border: none; background: none; outline: none; font-size: 13px; width: 100%; color: #0f172a; }
            .dw-conv-search-box svg { width: 16px; height: 16px; color: #94a3b8; flex: 0 0 auto; }
            .dw-conv-filterbtn { width: 38px; height: 38px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; display: flex; align-items: center; justify-content: center; color: #64748b; cursor: pointer; flex: 0 0 auto; }
            .dw-conv-filterbtn svg { width: 16px; height: 16px; }
            .dw-conv-tabs { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; background: #fff; flex-wrap: wrap; }
            .dw-conv-tab { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 9999px; border: 1px solid #e2e8f0; background: #fff; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
            .dw-conv-tab.active { background: #059669; border-color: #059669; color: #fff; }
            .dw-conv-tab .dot { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; }
            .dw-conv-item { display: flex; gap: 12px; align-items: flex-start; text-decoration: none; padding: 12px; border-bottom: 1px solid #f1f5f9; border-left: 3px solid transparent; }
            .dw-conv-item:hover { background: #f8fafc; }
            .dw-conv-item.active { background: #ecfdf5; border-left-color: #10b981; }
            .dw-conv-ava { width: 44px; height: 44px; border-radius: 50%; background: #e2e8f0; color: #475569; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex: 0 0 auto; }
            .dw-conv-body { flex: 1; min-width: 0; }
            .dw-conv-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 3px; }
            .dw-conv-name { font-size: 13px; font-weight: 700; color: #0f172a; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .dw-conv-time { font-size: 11px; color: #94a3b8; flex: 0 0 auto; }
            .dw-conv-snippet { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .dw-conv-badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 9999px; background: #10b981; color: #fff; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-left: 8px; flex: 0 0 auto; }
            .dw-conv-empty-filter { padding: 20px; color: #94a3b8; font-size: 12px; text-align: center; }
            /* --- Bloc 4 : fil central (en-tête + bulles + barre de saisie) --- */
            .dw-chat-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; background: #fff; border-bottom: 1px solid #e2e8f0; }
            .dw-chat-head-l { display: flex; align-items: center; gap: 12px; }
            .dw-chat-head-ava { width: 42px; height: 42px; border-radius: 50%; background: linear-gradient(135deg,#10b981,#059669); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
            .dw-chat-head-name { font-size: 15px; font-weight: 800; color: #0f172a; font-family: monospace; }
            .dw-chat-head-status { font-size: 12px; color: #059669; display: flex; align-items: center; gap: 5px; margin-top: 1px; }
            .dw-chat-head-actions { display: flex; gap: 6px; }
            .dw-chat-hbtn { width: 34px; height: 34px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #64748b; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s; }
            .dw-chat-hbtn:hover { border-color: #10b981; color: #059669; background: #f0fdf4; }
            .dw-chat-hbtn svg { width: 16px; height: 16px; }
            .dw-date-sep { align-self: center; background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 9999px; margin: 6px 0; }
            .dw-msg-meta { font-size: 10px; margin-top: 4px; display: flex; align-items: center; gap: 4px; justify-content: flex-end; }
            .dw-tick svg { width: 15px; height: 15px; vertical-align: middle; }
            .dw-input-toolbar { display: flex; align-items: center; gap: 2px; }
            .dw-input-icon { width: 34px; height: 34px; border-radius: 8px; border: none; background: none; color: #64748b; display: flex; align-items: center; justify-content: center; cursor: pointer; }
            .dw-input-icon:hover { color: #059669; background: #f0fdf4; }
            .dw-input-icon svg { width: 18px; height: 18px; }
            .dw-input-field { flex: 1; min-width: 0; padding: 11px 16px; border-radius: 9999px; border: 1px solid #cbd5e1; font-size: 13px; resize: none; outline: none; font-family: inherit; line-height: 1.4; }
            .dw-input-field:focus { border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.12); }
            .dw-templates-btn { display: inline-flex; align-items: center; gap: 5px; padding: 9px 13px; border-radius: 9999px; border: 1px solid #e2e8f0; background: #fff; color: #475569; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
            .dw-templates-btn:hover { border-color: #10b981; color: #059669; }
            .dw-templates-btn svg { width: 15px; height: 15px; }
            .dw-send-btn { width: 44px; height: 44px; border-radius: 50%; background: #059669; border: none; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto; transition: background .15s; }
            .dw-send-btn:hover { background: #047857; }
            .dw-input-wrap { position: relative; display: flex; align-items: center; gap: 8px; }
            .dw-pop { position: absolute; bottom: 54px; left: 0; z-index: 50; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 12px 30px -8px rgba(15,23,42,0.25); padding: 8px; display: none; }
            .dw-pop.open { display: block; }
            .dw-emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; width: 288px; }
            .dw-emoji-grid button { font-size: 20px; line-height: 1; border: none; background: none; cursor: pointer; padding: 6px; border-radius: 8px; }
            .dw-emoji-grid button:hover { background: #f1f5f9; }
            .dw-tpl-pop { right: 56px; left: auto; width: 320px; max-height: 300px; overflow-y: auto; }
            .dw-tpl-item { display: block; width: 100%; text-align: left; border: none; background: none; cursor: pointer; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; color: #334155; }
            .dw-tpl-item:hover { background: #f0fdf4; }
            .dw-tpl-item strong { display: block; color: #0f172a; font-size: 12px; margin-bottom: 2px; }
            .dw-attach-chip { display: none; align-items: center; gap: 8px; margin-bottom: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 8px 12px; font-size: 12px; color: #065f46; }
            .dw-attach-chip.show { display: flex; }
            .dw-attach-chip button { margin-left: auto; border: none; background: none; color: #059669; cursor: pointer; font-weight: 700; font-size: 14px; }
            .dw-chat-hbtn.on { border-color: #f59e0b; color: #d97706; background: #fffbeb; }
            .dw-send-btn svg { width: 20px; height: 20px; }
            /* --- Responsive : adaptation de la messagerie a la largeur --- */
            @media (max-width: 1024px) {
                .dw-chat-container { grid-template-columns: 280px minmax(0,1fr); }
                .dw-chat-crm { display: none; }
            }
            @media (max-width: 782px) {
                .dw-chat-container { grid-template-columns: 1fr; height: auto; }
                .dw-chat-list { max-height: 240px; border-right: none; border-bottom: 1px solid #e2e8f0; }
                .dw-chat-main { min-height: 460px; }
                .dw-header { flex-direction: column; align-items: flex-start; gap: 14px; }
                .dw-kpi-num { font-size: 24px; }
                .dw-chat-head-name { font-size: 14px; }
            }
            @media (max-width: 560px) {
                .dw-kpi-row { grid-template-columns: 1fr 1fr; }
                .dw-input-toolbar { display: none; }
                .dw-templates-btn { padding: 9px; }
                .dw-templates-btn span { display: none; }
            }
            .dw-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
            .dw-stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; }
            .dw-stat-num { font-size: 26px; font-weight: 800; color: #0f172a; margin-top: 4px; }
            .dw-stat-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
            /* --- Bloc 1 : rangée de cartes KPI (onglet Conversations) --- */
            .dw-kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 20px; }
            @media (max-width: 1280px) { .dw-kpi-row { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); } }
            .dw-kpi { background: #fff; border: 1px solid #e5e9f0; border-radius: 16px; padding: 18px 20px; display: flex; align-items: flex-start; gap: 14px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); transition: box-shadow 0.2s, transform 0.2s; }
            .dw-kpi:hover { box-shadow: 0 6px 16px -6px rgba(16,24,40,0.15); transform: translateY(-1px); }
            .dw-kpi-ico { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
            .dw-kpi-ico svg { width: 22px; height: 22px; }
            .dw-kpi-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
            .dw-kpi-label { font-size: 13px; font-weight: 600; color: #475569; }
            .dw-kpi-num { font-size: 30px; font-weight: 800; color: #0f172a; line-height: 1.05; }
            .dw-kpi-delta { font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 3px; }
            .dw-kpi-delta.up { color: #059669; }
            .dw-kpi-delta.flat { color: #94a3b8; }
            .dw-ico-green { background: #dcfce7; color: #059669; }
            .dw-ico-blue  { background: #dbeafe; color: #2563eb; }
            .dw-ico-amber { background: #fef3c7; color: #d97706; }
            .dw-ico-violet{ background: #ede9fe; color: #7c3aed; }
            .dw-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
            .dw-table th { background: #f8fafc; padding: 12px 14px; border-bottom: 2px solid #e2e8f0; font-weight: 700; color: #475569; }
            .dw-table td { padding: 12px 14px; border-bottom: 1px solid #f1f5f9; color: #334155; }
            .dw-table tr:hover td { background: #f8fafc; }
            /* --- Ecosysteme unifie : cohesion visuelle globale --- */
            .dw-wrap { max-width: 1440px; }
            .dw-wrap * { box-sizing: border-box; }
            .dw-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 9px 14px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
            .dw-flow-step { font-size: 10.5px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; padding: 4px 8px; border-radius: 8px; white-space: nowrap; }
            .dw-flow-step.on { background: #ecfdf5; color: #059669; }
            .dw-flow-arrow { color: #cbd5e1; font-size: 11px; flex: 0 0 auto; }
            .dw-section-intro { font-size: 13px; color: #64748b; margin: 0 0 18px; max-width: 760px; }
            .dw-table-wrap { width: 100%; overflow-x: auto; }
            .dw-badge-status { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; }
            .dw-st-actif { background: #dcfce7; color: #166534; }
            .dw-st-prospect { background: #e0f2fe; color: #075985; }
            .dw-st-optout { background: #fee2e2; color: #991b1b; }
            .dw-st-relance { background: #fef3c7; color: #92400e; }
            /* CRM & Contacts — liste + fiche */
            .dw-crm-listhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
            .dw-crm-kpis .dw-stat-box { min-width: 0; }
            .dw-crm-flash { background: #dcfce7; border: 1px solid #86efac; color: #166534; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
            .dw-crm-tagwrap { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
            .dw-crm-notebox { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #334155; line-height: 1.5; white-space: pre-wrap; }
            .dw-crm-form .dw-crm-select, .dw-crm-toolbar .dw-crm-select { cursor: pointer; background: #fff; color: #0f172a; }
            .dw-crm-fiche-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
            .dw-crm-back { text-decoration: none; color: #059669; font-weight: 700; font-size: 13px; }
            .dw-crm-fiche-actions { display: inline-flex; gap: 8px; flex-wrap: wrap; }
            .dw-crm-fiche-head { display: flex; align-items: center; gap: 14px; padding: 12px 0 16px; border-bottom: 1px solid #e2e8f0; margin-bottom: 16px; }
            .dw-crm-fiche-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; align-items: start; }
            .dw-crm-fiche-col { min-width: 0; }
            .dw-crm-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; margin-bottom: 6px; }
            .dw-crm-form-grid label, .dw-crm-form .dw-crm-section-title + * label { font-size: 11px; font-weight: 700; color: #64748b; display: flex; flex-direction: column; gap: 4px; }
            .dw-crm-form-grid .dw-crm-form-full { grid-column: 1 / -1; }
            .dw-crm-form-grid input, .dw-crm-form-grid select { font-family: inherit; font-size: 13px; font-weight: 500; color: #0f172a; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
            .dw-crm-form-grid input:focus, .dw-crm-form-grid select:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.12); }
            .dw-crm-form-grid input[readonly] { background: #f1f5f9; color: #64748b; }
            .dw-crm-notes-edit { width: 100%; font-family: inherit; font-size: 13px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; resize: vertical; box-sizing: border-box; }
            .dw-crm-savebtn-real { margin-top: 12px; background: #059669; color: #fff; border: none; border-radius: 9px; padding: 10px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
            .dw-crm-savebtn-real:hover { background: #047857; }
            .dw-crm-dangerbtn { background: #fff; color: #b91c1c; border: 1px solid #fecaca; border-radius: 9px; padding: 8px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
            .dw-crm-dangerbtn:hover { background: #fef2f2; }
            .dw-crm-statgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
            .dw-crm-statbox { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; text-align: center; }
            .dw-crm-statnum { display: block; font-size: 18px; font-weight: 800; color: #0f172a; }
            .dw-crm-statlbl { display: block; font-size: 10px; color: #94a3b8; font-weight: 600; margin-top: 2px; }
            @media (max-width: 900px) { .dw-crm-fiche-grid { grid-template-columns: 1fr; } .dw-crm-form-grid { grid-template-columns: 1fr; } }
            .dw-mini-avatar { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg,#10b981,#059669); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex: 0 0 auto; }
            .dw-cell-contact { display: flex; align-items: center; gap: 10px; }
            .dw-row-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; }
            .dw-mini-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #475569; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; }
            .dw-mini-btn:hover { border-color: #10b981; color: #059669; background: #f0fdf4; }
            .dw-mini-btn.primary { background: #059669; border-color: #059669; color: #fff; }
            .dw-mini-btn.primary:hover { background: #047857; color: #fff; }
            .dw-mini-btn svg { width: 14px; height: 14px; }
            .dw-crm-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
            .dw-crm-searchbox { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 12px; }
            .dw-crm-searchbox input { border: none; background: none; outline: none; font-size: 13px; width: 100%; color: #0f172a; }
            .dw-crm-searchbox svg { width: 16px; height: 16px; color: #94a3b8; flex: 0 0 auto; }
            .dw-empty-state { text-align: center; padding: 48px 20px; color: #94a3b8; font-size: 13px; }
            .dw-empty-state svg { width: 40px; height: 40px; margin-bottom: 12px; opacity: 0.5; }
            .dw-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
            .dw-crm-pill-blue { background: #dbeafe; color: #1e40af; }
            .dw-crm-manage { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; margin: 0 0 14px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
            .dw-crm-createform { display: inline-flex; align-items: center; gap: 6px; }
            .dw-crm-managelbl { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
            .dw-crm-createform input { font-family: inherit; font-size: 12px; padding: 6px 9px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #0f172a; max-width: 150px; }
            .dw-crm-createform input:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.12); }
            .dw-crm-addbtn { background: #059669; color: #fff; border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
            .dw-crm-addbtn:hover { background: #047857; }
            .dw-crm-addbtn:disabled { background: #cbd5e1; cursor: not-allowed; }
            .dw-crm-bulkbar { display: none; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; padding: 10px 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; }
            .dw-crm-bulkbar.show { display: flex; }
            .dw-crm-bulkcount { font-size: 12px; color: #065f46; }
            .dw-crm-bulkcount strong { font-size: 14px; }
            .dw-crm-bulkhint { font-size: 12px; color: #b91c1c; }
            .dw-crm-cbcell { width: 34px; text-align: center; }
            .dw-crm-cbcell input { width: 15px; height: 15px; cursor: pointer; }
            @media (max-width: 782px) {
                .dw-flow { display: none; }
                .dw-row-actions .dw-mini-btn span { display: none; }
            }
        ');
    }

    /**
     * Handle form submissions and direct actions
     */
    public static function handle_actions() {
        if (!current_user_can('manage_options') || empty($_POST['dw_wa_action'])) {
            return;
        }

        check_admin_referer('dw_wa_action_nonce');

        $action = sanitize_key($_POST['dw_wa_action']);

        // Templates & Civilités — persistance RÉELLE (table digiware_whatsapp_templates).
        if (in_array($action, array('tpl_save', 'tpl_delete', 'tpl_duplicate', 'tpl_status', 'tpl_civilites_save'), true)) {
            self::tpl_handle_actions($action);
            exit;
        }

        // Send single message from conversation interface -> voie RAPIDE (temps reel).
        // Ce nest PAS une campagne : pas de delai, pas de quota, pas de simulation de
        // frappe. Le client a deja engage la discussion, la reponse doit partir tout de suite.
        if ($action === 'send_direct_message') {
            $phone   = sanitize_text_field($_POST['recipient_phone']);
            $message = wp_unslash($_POST['message_content']);

            $ok = false;
            if ($phone !== '' && trim($message) !== '' && class_exists('\\DigiWare\\WhatsApp\\Sender\\WASenderQueue')) {
                $res = \DigiWare\WhatsApp\Sender\WASenderQueue::create_chat_message($phone, $message);
                $ok = !empty($res['success']);
            }

            wp_redirect(add_query_arg(array(
                'page'   => 'digiware-whatsapp',
                'tab'    => 'conversations',
                'thread' => preg_replace('/[^0-9]/', '', $phone),
                'status' => $ok ? 'queued' : 'failed',
            ), admin_url('admin.php')));
            exit;
        }

        // Save integrations / settings
        if ($action === 'save_settings') {
            $settings = array(
                'sender_endpoint'        => esc_url_raw($_POST['sender_endpoint']),
                'sender_api_key'         => sanitize_text_field($_POST['sender_api_key']),
                'sender_rate_limit'      => (int) $_POST['sender_rate_limit'],
                'default_country_prefix' => sanitize_text_field($_POST['default_country_prefix']),
                'omnitracker_endpoint'   => esc_url_raw($_POST['omnitracker_endpoint']),
                'ai_mode'                => sanitize_key($_POST['ai_mode']),
            );

            update_option('digiware_whatsapp_settings', $settings);

            wp_redirect(add_query_arg(array(
                'page'    => 'digiware-whatsapp',
                'tab'     => 'integrations',
                'updated' => 1,
            ), admin_url('admin.php')));
            exit;
        }

        // CRM & Contacts — enregistrement RÉEL de la fiche (table digiware_whatsapp_contacts).
        // Identité centrale = contact_id dérivé du téléphone (même règle que le webhook).
        if ($action === 'crm_save_contact') {
            global $wpdb;
            $table = $wpdb->prefix . 'digiware_whatsapp_contacts';
            $phone = self::crm_norm_phone(isset($_POST['phone']) ? wp_unslash($_POST['phone']) : '');
            $cid   = isset($_POST['contact_id']) ? sanitize_text_field(wp_unslash($_POST['contact_id'])) : '';
            if ($cid === '' || $cid === 'new') { $cid = $phone !== '' ? 'ct_' . substr(md5($phone), 0, 8) : ''; }
            if ($cid === '') {
                wp_redirect(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm','contact'=>'new','crm'=>'error'), admin_url('admin.php')));
                exit;
            }
            $status = isset($_POST['commercial_status']) ? sanitize_key(wp_unslash($_POST['commercial_status'])) : 'prospect';
            if (!in_array($status, array_keys(self::crm_status_defs()), true)) { $status = 'prospect'; }
            $to_list = function($raw) {
                $out = array();
                foreach (explode(',', (string) $raw) as $p) { $p = trim($p); if ($p !== '') { $out[] = sanitize_text_field($p); } }
                return array_values(array_unique($out));
            };
            $data = array(
                'contact_id'        => $cid,
                'first_name'        => sanitize_text_field(isset($_POST['first_name']) ? wp_unslash($_POST['first_name']) : ''),
                'last_name'         => sanitize_text_field(isset($_POST['last_name']) ? wp_unslash($_POST['last_name']) : ''),
                'civility'          => sanitize_text_field(isset($_POST['civility']) ? wp_unslash($_POST['civility']) : ''),
                'profession'        => sanitize_text_field(isset($_POST['profession']) ? wp_unslash($_POST['profession']) : ''),
                'job_title'         => sanitize_text_field(isset($_POST['job_title']) ? wp_unslash($_POST['job_title']) : ''),
                'phone'             => $phone,
                'email'             => sanitize_email(isset($_POST['email']) ? wp_unslash($_POST['email']) : ''),
                'company'           => sanitize_text_field(isset($_POST['company']) ? wp_unslash($_POST['company']) : ''),
                'address'           => sanitize_text_field(isset($_POST['address']) ? wp_unslash($_POST['address']) : ''),
                'city'              => sanitize_text_field(isset($_POST['city']) ? wp_unslash($_POST['city']) : ''),
                'sector'            => sanitize_text_field(isset($_POST['sector']) ? wp_unslash($_POST['sector']) : ''),
                'tags_json'         => wp_json_encode($to_list(isset($_POST['tags']) ? wp_unslash($_POST['tags']) : '')),
                'segments_json'     => wp_json_encode($to_list(isset($_POST['segments']) ? wp_unslash($_POST['segments']) : '')),
                'commercial_status' => $status,
                'opt_in'            => (isset($_POST['opt_in']) && $_POST['opt_in'] === '1') ? 1 : 0,
                'notes'             => sanitize_textarea_field(isset($_POST['notes']) ? wp_unslash($_POST['notes']) : ''),
                'updated_at'        => current_time('mysql'),
            );
            $exists = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$table} WHERE contact_id = %s", $cid));
            if ($exists) { $wpdb->update($table, $data, array('id' => $exists)); }
            else { $data['created_at'] = current_time('mysql'); $wpdb->insert($table, $data); }

            wp_redirect(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm','contact'=>$cid,'phone'=>$phone,'crm'=>'saved'), admin_url('admin.php')));
            exit;
        }

        if ($action === 'crm_delete_contact') {
            global $wpdb;
            $table = $wpdb->prefix . 'digiware_whatsapp_contacts';
            $cid = isset($_POST['contact_id']) ? sanitize_text_field(wp_unslash($_POST['contact_id'])) : '';
            if ($cid !== '') { $wpdb->delete($table, array('contact_id' => $cid)); }
            wp_redirect(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm','crm'=>'deleted'), admin_url('admin.php')));
            exit;
        }

        // CRM — création RÉELLE d'un tag ou d'un segment (catalogue persistant wp_options).
        if ($action === 'crm_create_tag' || $action === 'crm_create_segment') {
            $is_tag = ($action === 'crm_create_tag');
            $opt = $is_tag ? 'digiware_whatsapp_tags' : 'digiware_whatsapp_segments';
            $val = sanitize_text_field(wp_unslash(isset($_POST['label']) ? $_POST['label'] : ''));
            if ($val !== '') {
                $cat = get_option($opt, array());
                if (!is_array($cat)) { $cat = array(); }
                $low = array_map(function ($x) { return function_exists('mb_strtolower') ? mb_strtolower($x) : strtolower($x); }, $cat);
                if (!in_array(function_exists('mb_strtolower') ? mb_strtolower($val) : strtolower($val), $low, true)) {
                    $cat[] = $val;
                    update_option($opt, array_values($cat));
                }
            }
            wp_redirect(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm','crm'=>($is_tag ? 'tag_created' : 'segment_created')), admin_url('admin.php')));
            exit;
        }

        // CRM — action groupée RÉELLE : ajouter/retirer un tag ou segment aux contacts sélectionnés.
        if ($action === 'crm_bulk_apply') {
            global $wpdb;
            $table = $wpdb->prefix . 'digiware_whatsapp_contacts';
            $kind = (isset($_POST['bulk_kind']) && $_POST['bulk_kind'] === 'segment') ? 'segment' : 'tag';
            $op   = (isset($_POST['bulk_op']) && $_POST['bulk_op'] === 'remove') ? 'remove' : 'add';
            $val  = sanitize_text_field(wp_unslash(isset($_POST['bulk_value']) ? $_POST['bulk_value'] : ''));
            $phones = (isset($_POST['contacts']) && is_array($_POST['contacts'])) ? $_POST['contacts'] : array();
            $col = ($kind === 'segment') ? 'segments_json' : 'tags_json';
            $other_col = ($kind === 'segment') ? 'tags_json' : 'segments_json';
            $lc = function ($x) { return function_exists('mb_strtolower') ? mb_strtolower($x) : strtolower($x); };
            $n = 0;
            if ($val !== '' && !empty($phones)) {
                if ($op === 'add') {
                    $opt = ($kind === 'segment') ? 'digiware_whatsapp_segments' : 'digiware_whatsapp_tags';
                    $cat = get_option($opt, array());
                    if (!is_array($cat)) { $cat = array(); }
                    if (!in_array($lc($val), array_map($lc, $cat), true)) { $cat[] = $val; update_option($opt, array_values($cat)); }
                }
                foreach ($phones as $ph) {
                    $norm = self::crm_norm_phone(wp_unslash($ph));
                    if ($norm === '') { continue; }
                    $cid = 'ct_' . substr(md5($norm), 0, 8);
                    $rec = $wpdb->get_row($wpdb->prepare("SELECT id, {$col} FROM {$table} WHERE contact_id = %s", $cid), ARRAY_A);
                    $list = $rec ? (array) json_decode((string) $rec[$col], true) : array();
                    $list = array_values(array_filter(array_map('trim', $list)));
                    $has = in_array($lc($val), array_map($lc, $list), true);
                    if ($op === 'add' && !$has) { $list[] = $val; }
                    elseif ($op === 'remove' && $has) { $list = array_values(array_filter($list, function ($x) use ($val, $lc) { return $lc($x) !== $lc($val); })); }
                    else { continue; }
                    $json = wp_json_encode(array_values($list));
                    if ($rec) {
                        $wpdb->update($table, array($col => $json, 'updated_at' => current_time('mysql')), array('id' => $rec['id']));
                    } elseif ($op === 'add') {
                        $wpdb->insert($table, array(
                            'contact_id'        => $cid,
                            'phone'             => $norm,
                            $col                => $json,
                            $other_col          => '[]',
                            'commercial_status' => '',
                            'created_at'        => current_time('mysql'),
                            'updated_at'        => current_time('mysql'),
                        ));
                    }
                    $n++;
                }
            }
            wp_redirect(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm','crm'=>'bulk','n'=>$n), admin_url('admin.php')));
            exit;
        }

        // ================= CAMPAGNES (Business Center) =================
        // Enregistre une campagne en BROUILLON ou PROGRAMMÉE (aucun job créé ici).
        // La création réelle des jobs se fait uniquement au lancement (bc_campaign_launch)
        // ou, pour une campagne programmée, par la relève automatique des échéances.
        if ($action === 'bc_campaign_save') {
            $id  = self::bc_save_from_post();
            $go  = isset($_POST['bc_after']) ? sanitize_key($_POST['bc_after']) : 'list';
            $args = array('page'=>'digiware-whatsapp','tab'=>'campaigns');
            if ($go === 'edit' && $id) { $args['action'] = 'edit'; $args['id'] = $id; $args['bc'] = 'saved'; }
            else { $args['bc'] = 'saved'; }
            wp_redirect(add_query_arg($args, admin_url('admin.php')));
            exit;
        }

        // Lance une campagne : enregistre (au besoin) puis crée les jobs dans la file
        // opérationnelle WASender (aucune seconde file). "Programmer" => statut scheduled,
        // jobs créés plus tard automatiquement. "Maintenant" => jobs créés immédiatement.
        if ($action === 'bc_campaign_launch') {
            $id = self::bc_save_from_post();
            $res = array('ok'=>false);
            if ($id) {
                $c = self::bc_get($id);
                if ($c && $c['schedule_mode'] === 'scheduled' && !empty($c['scheduled_at']) && strtotime($c['scheduled_at']) > current_time('timestamp')) {
                    self::bc_update($id, array('status'=>'scheduled'));
                    $res = array('ok'=>true, 'scheduled'=>true);
                } else {
                    $res = self::bc_launch($id);
                }
            }
            $args = array('page'=>'digiware-whatsapp','tab'=>'campaigns');
            if (!empty($res['scheduled'])) { $args['bc'] = 'scheduled'; }
            elseif (!empty($res['ok']))    { $args['bc'] = 'launched'; $args['n'] = isset($res['jobs_created']) ? (int)$res['jobs_created'] : 0; }
            else                           { $args['bc'] = 'launch_error'; }
            if ($id) { $args['id'] = $id; $args['action'] = 'view'; }
            wp_redirect(add_query_arg($args, admin_url('admin.php')));
            exit;
        }

        if ($action === 'bc_campaign_delete') {
            $id = isset($_POST['id']) ? (int) $_POST['id'] : 0;
            if ($id) {
                $c = self::bc_get($id);
                // On ne supprime qu'une définition non lancée (les jobs lancés appartiennent au Sender).
                if ($c && $c['status'] !== 'launched') { self::bc_delete($id); }
            }
            wp_redirect(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'campaigns','bc'=>'deleted'), admin_url('admin.php')));
            exit;
        }

        if ($action === 'bc_campaign_duplicate') {
            $id = isset($_POST['id']) ? (int) $_POST['id'] : 0;
            $new = $id ? self::bc_duplicate($id) : 0;
            $args = array('page'=>'digiware-whatsapp','tab'=>'campaigns','bc'=>'duplicated');
            if ($new) { $args['action'] = 'edit'; $args['id'] = $new; }
            wp_redirect(add_query_arg($args, admin_url('admin.php')));
            exit;
        }
    }

    /**
     * Render the DigiWare WhatsApp Business Center admin page
     */
    public static function render_page() {
        $tab = isset($_GET['tab']) ? sanitize_key($_GET['tab']) : 'dashboard';

        // Relève des campagnes PROGRAMMÉES arrivées à échéance (le hook Admin n'est
        // enregistré que sous is_admin() : WP-cron ne peut pas l'atteindre, on balaye
        // donc au chargement du Business Center — honnête, sans fausse tâche cron).
        self::bc_process_due_campaigns();

        // Etat REEL de la "main" Node (basé sur le dernier ping reçu), plus de sonde Cloud Run.
        $sender_health = array('connected' => false, 'status' => 'hors ligne', 'endpoint' => rest_url('wasender/v1'));
        if (class_exists('\\DigiWare\\WhatsApp\\Sender\\WASenderQueue')) {
            $sc = \DigiWare\WhatsApp\Sender\WASenderQueue::get_status_counts();
            $sender_health['connected'] = !empty($sc['node_connected']);
            $sender_health['status']    = !empty($sc['node_connected']) ? 'application Node active' : 'aucun signal récent';
        }

        $tabs = array(
            'dashboard'     => '📊 Tableau de bord',
            'conversations' => '💬 Conversations',
            'crm'           => '👥 CRM & Contacts',
            'campaigns'     => '🚀 Campagnes Multisegments',
            'templates'     => '📝 Templates & Civilités',
            'catalog'       => '🛍️ Produits & Catalogue',
            'links'         => '🔗 Link Center',
            'ai_agent'      => '🤖 AI Agent Commercial',
            'analytics'     => '📊 Analytics & Clics',
            'activity'      => '📜 Journal & Traçabilité',
            'integrations'  => '⚙️ Intégrations & Paramètres',
        );

        ?>
        <div class="wrap dw-wrap">
            <div class="dw-header">
                <div>
                    <h1 class="dw-title">
                        <span>DigiWare WhatsApp Business Center</span>
                        <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 700;">v2.0 PRO</span>
                    </h1>
                    <p style="margin: 0; font-size: 13px; color: #a7f3d0;">
                        Messagerie omnicanale, orchestration de campagnes multisegments &amp; connexion directe au WhatsApp Sender.
                    </p>
                </div>
                <div>
                    <?php if ($sender_health['connected']): ?>
                        <span class="dw-badge-online">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background: #4ade80;"></span>
                            Sender Connecté (<?php echo esc_html($sender_health['status']); ?>)
                        </span>
                    <?php else: ?>
                        <span class="dw-badge-offline">
                            ⚠️ Sender Déconnecté (<?php echo esc_html($sender_health['endpoint']); ?>)
                        </span>
                    <?php endif; ?>
                </div>
            </div>

            <!-- Navigation Tabs -->
            <div class="dw-nav-tabs">
                <?php foreach ($tabs as $key => $label): ?>
                    <a href="<?php echo esc_url(add_query_arg('tab', $key, admin_url('admin.php?page=digiware-whatsapp'))); ?>" 
                       class="dw-tab-link <?php echo $tab === $key ? 'active' : ''; ?>">
                        <?php echo esc_html($label); ?>
                    </a>
                <?php endforeach; ?>
            </div>

            <!-- Tab Content -->
            <?php
            // Ruban ecosysteme : une seule histoire, du contact jusqu'aux analytics.
            $flow = array(
                'contact'      => array('Contact', 'crm'),
                'conversation' => array('Conversation', 'conversations'),
                'crm'          => array('CRM', 'crm'),
                'campagne'     => array('Campagne', 'campaigns'),
                'template'     => array('Template', 'templates'),
                'produit'      => array('Produit', 'catalog'),
                'lien'         => array('Lien', 'links'),
                'tracking'     => array('Tracking', 'activity'),
                'activite'     => array('Activite', 'activity'),
                'analytics'    => array('Analytics', 'analytics'),
            );
            $flow_active = array(
                'conversations' => 'conversation',
                'crm'           => 'crm',
                'campaigns'     => 'campagne',
                'templates'     => 'template',
                'catalog'       => 'produit',
                'links'         => 'lien',
                'activity'      => 'activite',
                'analytics'     => 'analytics',
            );
            $cur_step = isset($flow_active[$tab]) ? $flow_active[$tab] : '';
            ?>
            <?php if ($tab !== 'dashboard'): ?>
            <div class="dw-flow" role="navigation" aria-label="Parcours commercial unifie">
                <?php $fi = 0; foreach ($flow as $skey => $sinfo):
                    $surl = esc_url(add_query_arg('tab', $sinfo[1], admin_url('admin.php?page=digiware-whatsapp')));
                    if ($fi > 0): ?><span class="dw-flow-arrow">&rsaquo;</span><?php endif; ?>
                    <a href="<?php echo $surl; ?>" class="dw-flow-step<?php echo $cur_step === $skey ? ' on' : ''; ?>" style="text-decoration:none;"><?php echo esc_html($sinfo[0]); ?></a>
                <?php $fi++; endforeach; ?>
            </div>
            <?php endif; ?>
            <?php
            switch ($tab) {
                case 'crm':
                    self::render_crm_tab();
                    break;
                case 'campaigns':
                    self::render_campaigns_tab();
                    break;
                case 'templates':
                    self::render_templates_tab();
                    break;
                case 'catalog':
                    self::render_catalog_tab();
                    break;
                case 'links':
                    self::render_links_tab();
                    break;
                case 'ai_agent':
                    self::render_ai_agent_tab();
                    break;
                case 'analytics':
                    self::render_analytics_tab();
                    break;
                case 'activity':
                    self::render_activity_tab();
                    break;
                case 'integrations':
                    self::render_integrations_tab($sender_health);
                    break;
                case 'conversations':
                    self::render_conversations_tab($sender_health);
                    break;
                case 'dashboard':
                default:
                    self::render_dashboard_tab($sender_health);
                    break;
            }
            ?>
        </div>
        <?php
    }

    /* =====================================================================
     * TABLEAU DE BORD — vue de pilotage du WhatsApp Business Center.
     * LECTURE SEULE. Réutilise WASenderQueue::get_status_counts() + les
     * tables réelles (wasender_jobs / wasender_replies / wasender_campaigns)
     * et WooCommerce. Aucune donnée fictive : une métrique sans source
     * réelle est affichée « indisponible », jamais simulée.
     * ===================================================================== */

    /** Décalage d'affichage vers l'heure de Tunisie (Africa/Tunis, sans DST). */
    private static function dash_tz_offset() { return 3600; }

    /** Résout la période (?range=today|7d|30d). Bornes calculées en UTC. */
    private static function dash_period() {
        $range = isset($_GET['range']) ? sanitize_key($_GET['range']) : '7d';
        if (!in_array($range, array('today', '7d', '30d'), true)) { $range = '7d'; }
        $off = self::dash_tz_offset();
        $now = time();
        $midnight = (int) (floor(($now + $off) / 86400) * 86400) - $off; // minuit local -> UTC
        if ($range === 'today') {
            $start = $midnight;              $days = 1;  $gran = 'hour';
        } elseif ($range === '30d') {
            $start = $midnight - 29 * 86400; $days = 30; $gran = 'day';
        } else {
            $start = $midnight - 6 * 86400;  $days = 7;  $gran = 'day';
        }
        $end  = $now;
        $span = max(1, $end - $start);
        return array(
            'range'          => $range,
            'gran'           => $gran,
            'days'           => $days,
            'start'          => $start,
            'end'            => $end,
            'start_sql'      => gmdate('Y-m-d H:i:s', $start),
            'end_sql'        => gmdate('Y-m-d H:i:s', $end),
            'prev_start_sql' => gmdate('Y-m-d H:i:s', $start - $span),
            'prev_end_sql'   => gmdate('Y-m-d H:i:s', $start),
            'label'          => $range === 'today' ? "Aujourd'hui" : ($range === '30d' ? '30 derniers jours' : '7 derniers jours'),
        );
    }

    /** Sous-requête normalisée : tous les évènements (sortants + entrants). */
    private static function dash_union_sql() {
        global $wpdb;
        $jobs    = $wpdb->prefix . 'wasender_jobs';
        $replies = $wpdb->prefix . 'wasender_replies';
        return "SELECT REPLACE(REPLACE(phone,'+',''),' ','') AS norm, COALESCE(sent_at, created_at, updated_at) AS t, 0 AS inbound FROM {$jobs}
                UNION ALL
                SELECT REPLACE(REPLACE(phone,'+',''),' ','') AS norm, received_at AS t, 1 AS inbound FROM {$replies}";
    }

    /** Métriques messagerie réelles (wasender_jobs + wasender_replies). */
    private static function dash_data($p) {
        global $wpdb;
        $jobs    = $wpdb->prefix . 'wasender_jobs';
        $replies = $wpdb->prefix . 'wasender_replies';
        $u = self::dash_union_sql();
        $s = $p['start_sql']; $e = $p['end_sql'];
        $ps = $p['prev_start_sql']; $pe = $p['prev_end_sql'];
        $ok = "('sent','delivered','read')";

        $d = array();
        // Messages (créés sur la période) + période précédente
        $d['messages']      = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$jobs} WHERE created_at >= %s AND created_at < %s", $s, $e));
        $d['messages_prev'] = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$jobs} WHERE created_at >= %s AND created_at < %s", $ps, $pe));
        // Messages réellement partis (sent/delivered/read)
        $d['sent']      = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$jobs} WHERE status IN {$ok} AND created_at >= %s AND created_at < %s", $s, $e));
        $d['sent_prev'] = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$jobs} WHERE status IN {$ok} AND created_at >= %s AND created_at < %s", $ps, $pe));
        // Réponses entrantes
        $d['replies']      = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$replies} WHERE received_at >= %s AND received_at < %s", $s, $e));
        $d['replies_prev'] = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$replies} WHERE received_at >= %s AND received_at < %s", $ps, $pe));
        // Conversations actives (numéros distincts avec activité sur la période)
        $d['conv']      = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(DISTINCT norm) FROM ({$u}) x WHERE t >= %s AND t < %s", $s, $e));
        $d['conv_prev'] = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(DISTINCT norm) FROM ({$u}) x WHERE t >= %s AND t < %s", $ps, $pe));
        // Contacts : total distinct (historique complet) + nouveaux (1er contact sur la période)
        $d['contacts_total'] = (int) $wpdb->get_var("SELECT COUNT(*) FROM (SELECT norm FROM ({$u}) a GROUP BY norm) z");
        $d['contacts_new']   = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM (SELECT norm, MIN(t) mn FROM ({$u}) a GROUP BY norm) z WHERE mn >= %s AND mn < %s", $s, $e));
        // À traiter : conversations en attente de NOTRE réponse (dernier évènement = entrant)
        $d['awaiting'] = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM (
                SELECT norm, MAX(CASE WHEN inbound=1 THEN t END) mi, MAX(CASE WHEN inbound=0 THEN t END) mo
                FROM ({$u}) a GROUP BY norm
             ) z WHERE mi IS NOT NULL AND (mo IS NULL OR mi > mo)"
        );
        // Nouvelles conversations sur la période (déjà = contacts_new, gardé explicite pour « À traiter »)
        $d['new_conv'] = $d['contacts_new'];
        // Taux de réponse (réponses / messages partis) — calculable, honnête
        $d['reply_rate']      = $d['sent'] > 0 ? round($d['replies'] / $d['sent'] * 100, 1) : null;
        $d['reply_rate_prev'] = $d['sent_prev'] > 0 ? round($d['replies_prev'] / $d['sent_prev'] * 100, 1) : null;
        return $d;
    }

    /**
     * Engagement site ATTRIBUÉ WhatsApp — le seul « reste du site » que le
     * Business Center a le droit de voir : les visiteurs arrivés via un lien
     * WhatsApp (évènements whatsapp_click) et leurs compteurs.
     *
     * Lu EXCLUSIVEMENT par l'API documentée d'OmniTracker (jamais de SQL direct
     * sur les tables omnitracker). Dégrade proprement si OmniTracker est absent.
     * Aucune donnée globale du site : source filtrée sur « whatsapp ».
     */
    private static function dash_wa_site($p) {
        $out = array('available' => false, 'attribution' => false);
        $api = apply_filters('omnitracker_api_v1', null);
        if (!is_object($api) || !method_exists($api, 'overview')) {
            return $out; // OmniTracker absent -> « Données indisponibles »
        }

        $cur  = array('start_utc' => $p['start_sql'],      'end_utc' => $p['end_sql']);
        $prev = array('start_utc' => $p['prev_start_sql'], 'end_utc' => $p['prev_end_sql']);
        try {
            // overview(range, source='whatsapp', event_type='whatsapp_click')
            // -> clics + visiteurs distincts arrivés par un lien WhatsApp.
            $c = $api->overview($cur,  'whatsapp', 'whatsapp_click');
            $q = $api->overview($prev, 'whatsapp', 'whatsapp_click');
        } catch (\Throwable $e) {
            return $out;
        }
        $out['available']     = true;
        $out['clicks']        = (int) ($c['events']   ?? 0);
        $out['visitors']      = (int) ($c['visitors'] ?? 0);
        $out['clicks_prev']   = (int) ($q['events']   ?? 0);
        $out['visitors_prev'] = (int) ($q['visitors'] ?? 0);
        // Conversions / CA attribués WhatsApp : aucune API d'attribution
        // (clic WhatsApp -> achat) n'est reliée pour le moment. On ne fabrique
        // rien -> « Données indisponibles ». ($out['attribution'] reste false.)
        return $out;
    }

    /** Séries temporelles réelles pour le graphique (messages/réponses/conversations). */
    private static function dash_series($p) {
        global $wpdb;
        $jobs    = $wpdb->prefix . 'wasender_jobs';
        $replies = $wpdb->prefix . 'wasender_replies';
        $u = self::dash_union_sql();
        $s = $p['start_sql']; $e = $p['end_sql'];
        $off  = self::dash_tz_offset();
        $size = $p['gran'] === 'hour' ? 3600 : 86400;
        $n    = (int) max(1, ceil(($p['end'] - $p['start']) / $size));

        $buckets = array();
        for ($i = 0; $i < $n; $i++) {
            $bs = $p['start'] + $i * $size;
            $buckets[$i] = array(
                'label'    => $p['gran'] === 'hour' ? gmdate('H\h', $bs + $off) : gmdate('d/m', $bs + $off),
                'messages' => 0, 'replies' => 0, 'conv' => 0,
            );
        }
        $idx = function($ts) use ($p, $size, $n) {
            $i = (int) floor(($ts - $p['start']) / $size);
            return ($i < 0 || $i >= $n) ? -1 : $i;
        };
        // Messages
        foreach ((array) $wpdb->get_col($wpdb->prepare("SELECT UNIX_TIMESTAMP(created_at) FROM {$jobs} WHERE created_at >= %s AND created_at < %s", $s, $e)) as $ts) {
            $i = $idx((int) $ts); if ($i >= 0) { $buckets[$i]['messages']++; }
        }
        // Réponses
        foreach ((array) $wpdb->get_col($wpdb->prepare("SELECT UNIX_TIMESTAMP(received_at) FROM {$replies} WHERE received_at >= %s AND received_at < %s", $s, $e)) as $ts) {
            $i = $idx((int) $ts); if ($i >= 0) { $buckets[$i]['replies']++; }
        }
        // Conversations distinctes par bucket
        $seen = array();
        $rows = $wpdb->get_results($wpdb->prepare("SELECT norm, UNIX_TIMESTAMP(t) ts FROM ({$u}) x WHERE t >= %s AND t < %s", $s, $e));
        foreach ((array) $rows as $r) {
            $i = $idx((int) $r->ts); if ($i < 0) { continue; }
            $k = $i . '|' . $r->norm;
            if (!isset($seen[$k])) { $seen[$k] = 1; $buckets[$i]['conv']++; }
        }
        return array_values($buckets);
    }

    /** Flux « Activité récente » — évènements WhatsApp réels (réponses reçues, messages envoyés). */
    private static function dash_recent() {
        global $wpdb;
        $jobs    = $wpdb->prefix . 'wasender_jobs';
        $replies = $wpdb->prefix . 'wasender_replies';
        $conv_url = admin_url('admin.php?page=digiware-whatsapp&tab=conversations');
        $items = array();

        foreach ((array) $wpdb->get_results("SELECT phone, message, received_at FROM {$replies} ORDER BY received_at DESC LIMIT 10") as $r) {
            $items[] = array(
                'ts'   => strtotime($r->received_at . ' UTC'),
                'icon' => '💬', 'cls' => 'in',
                'text' => 'Réponse reçue de <b>' . esc_html($r->phone) . '</b>',
                'when' => self::fmt_time($r->received_at, 'd/m H:i'),
                'link' => $conv_url,
            );
        }
        foreach ((array) $wpdb->get_results("SELECT phone, sent_at FROM {$jobs} WHERE status IN ('sent','delivered','read') AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 10") as $r) {
            $items[] = array(
                'ts'   => strtotime($r->sent_at . ' UTC'),
                'icon' => '📤', 'cls' => 'out',
                'text' => 'Message envoyé à <b>' . esc_html($r->phone) . '</b>',
                'when' => self::fmt_time($r->sent_at, 'd/m H:i'),
                'link' => $conv_url,
            );
        }
        usort($items, function($a, $b) { return $b['ts'] - $a['ts']; });
        return array_slice($items, 0, 12);
    }

    /** Campagnes réellement actives (non terminées). */
    private static function dash_campaigns() {
        global $wpdb;
        $t = $wpdb->prefix . 'wasender_campaigns';
        return (array) $wpdb->get_results("SELECT id, name, status, total, sent, failed, created_at FROM {$t} WHERE status <> 'done' ORDER BY created_at DESC LIMIT 6");
    }

    /** Puce d'évolution vs période précédente. Retourne '' si non calculable. */
    private static function dash_delta_html($cur, $prev) {
        if ($prev === null || $prev <= 0) {
            return '<span class="dw-delta dw-delta-na" title="Aucune donnée sur la période précédente">—</span>';
        }
        $pct = round(($cur - $prev) / $prev * 100);
        if ($pct > 0)  { return '<span class="dw-delta dw-delta-up">▲ ' . $pct . '%</span>'; }
        if ($pct < 0)  { return '<span class="dw-delta dw-delta-down">▼ ' . abs($pct) . '%</span>'; }
        return '<span class="dw-delta dw-delta-flat">= 0%</span>';
    }

    /** Graphique SVG (rendu serveur) des séries réelles. Échelle Y partagée. */
    private static function dash_area_svg($series) {
        $W = 1000; $H = 260; $padL = 40; $padR = 16; $padT = 16; $padB = 28;
        $n = count($series);
        $keys = array(
            'messages' => array('#25D366', 'Messages'),
            'replies'  => array('#0ea5e9', 'Réponses'),
            'conv'     => array('#a855f7', 'Conversations'),
        );
        $max = 1;
        foreach ($series as $b) { foreach ($keys as $k => $_) { if ($b[$k] > $max) { $max = $b[$k]; } } }
        $plotW = $W - $padL - $padR; $plotH = $H - $padT - $padB;
        $xat = function($i) use ($n, $padL, $plotW) {
            return $n <= 1 ? $padL + $plotW / 2 : $padL + $i * ($plotW / ($n - 1));
        };
        $yat = function($v) use ($max, $padT, $plotH) {
            return $padT + $plotH - ($v / $max) * $plotH;
        };
        $svg  = '<svg class="dw-chart-svg" viewBox="0 0 ' . $W . ' ' . $H . '" preserveAspectRatio="none" role="img">';
        // Grille horizontale (0, max/2, max)
        foreach (array(0, 0.5, 1) as $g) {
            $y = $padT + $plotH - $g * $plotH;
            $svg .= '<line x1="' . $padL . '" y1="' . round($y, 1) . '" x2="' . ($W - $padR) . '" y2="' . round($y, 1) . '" class="dw-grid"/>';
            $svg .= '<text x="4" y="' . round($y + 4, 1) . '" class="dw-axis-y">' . round($max * $g) . '</text>';
        }
        // Labels X (max ~7)
        $step = max(1, (int) ceil($n / 7));
        for ($i = 0; $i < $n; $i += $step) {
            $svg .= '<text x="' . round($xat($i), 1) . '" y="' . ($H - 8) . '" class="dw-axis-x">' . esc_html($series[$i]['label']) . '</text>';
        }
        // Séries
        foreach ($keys as $k => $meta) {
            $pts = array();
            foreach ($series as $i => $b) { $pts[] = round($xat($i), 1) . ',' . round($yat($b[$k]), 1); }
            $hidden = $k === 'messages' ? '' : ' style="display:none"';
            $svg .= '<polyline class="dw-line dw-line-' . $k . '" data-key="' . $k . '" points="' . implode(' ', $pts) . '" fill="none" stroke="' . $meta[0] . '" stroke-width="2.5"' . $hidden . '/>';
            foreach ($series as $i => $b) {
                $svg .= '<circle class="dw-dot dw-dot-' . $k . '" data-key="' . $k . '" cx="' . round($xat($i), 1) . '" cy="' . round($yat($b[$k]), 1) . '" r="2.5" fill="' . $meta[0] . '"' . $hidden . '><title>' . esc_html($series[$i]['label'] . ' · ' . $meta[1] . ' : ' . $b[$k]) . '</title></circle>';
            }
        }
        $svg .= '</svg>';
        return $svg;
    }

    /**
     * TABLEAU DE BORD — point d'entrée de pilotage.
     * Synthétise les données réelles disponibles et renvoie vers les modules.
     */
    private static function render_dashboard_tab($sender_health) {
        $p         = self::dash_period();
        $d         = self::dash_data($p);
        $wa        = self::dash_wa_site($p);
        $series    = self::dash_series($p);
        $recent    = self::dash_recent();
        $campaigns = self::dash_campaigns();

        $base = admin_url('admin.php?page=digiware-whatsapp&tab=dashboard');
        $ranges = array('today' => "Aujourd'hui", '7d' => '7 jours', '30d' => '30 jours');
        $connected = !empty($sender_health['connected']);

        $url = function($tab, $args = array()) {
            $u = admin_url('admin.php?page=digiware-whatsapp&tab=' . $tab);
            foreach ($args as $k => $v) { $u .= '&' . $k . '=' . rawurlencode($v); }
            return $u;
        };
        ?>
        <style>
        .dw-dash{--g:#25D366;--ink:#0f172a;--mut:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:1280px}
        .dw-dash *{box-sizing:border-box}
        .dw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;margin:0 0 22px}
        .dw-head h1{font-size:24px;font-weight:700;margin:0 0 4px;letter-spacing:-.02em}
        .dw-head .dw-sub{color:var(--mut);font-size:13.5px;margin:0}
        .dw-head-right{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
        .dw-range{display:inline-flex;background:#eef2f6;border-radius:9px;padding:3px}
        .dw-range a{padding:6px 13px;border-radius:7px;font-size:13px;font-weight:600;color:var(--mut);text-decoration:none;line-height:1}
        .dw-range a.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
        .dw-conn{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card)}
        .dw-conn .dot{width:9px;height:9px;border-radius:50%}
        .dw-conn.ok .dot{background:var(--g);box-shadow:0 0 0 3px rgba(37,211,102,.18)}
        .dw-conn.off .dot{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.18)}
        .dw-conn.ok{color:#0a7d3f}.dw-conn.off{color:#b91c1c}
        .dw-grid-kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin:0 0 22px}
        .dw-kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 16px 14px;display:flex;flex-direction:column;gap:8px;min-height:104px}
        .dw-kpi .k-top{display:flex;align-items:center;justify-content:space-between}
        .dw-kpi .k-ic{font-size:16px;opacity:.9}
        .dw-kpi .k-val{font-size:26px;font-weight:750;letter-spacing:-.02em;line-height:1}
        .dw-kpi .k-lab{font-size:12.5px;color:var(--mut);font-weight:600}
        .dw-kpi .k-ctx{font-size:11.5px;color:#94a3b8}
        .dw-kpi .k-na{font-size:13px;color:#94a3b8;font-weight:600}
        .dw-delta{font-size:11.5px;font-weight:700;padding:2px 7px;border-radius:20px;white-space:nowrap}
        .dw-delta-up{color:#0a7d3f;background:rgba(37,211,102,.12)}
        .dw-delta-down{color:#b91c1c;background:rgba(239,68,68,.10)}
        .dw-delta-flat,.dw-delta-na{color:#94a3b8;background:#f1f5f9}
        .dw-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 0 22px}
        .dw-card2{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
        .dw-card2 .c-h{display:flex;align-items:center;justify-content:space-between;margin:0 0 14px}
        .dw-card2 .c-h h2{font-size:15px;font-weight:700;margin:0}
        .dw-card2 .c-h .c-sub{font-size:11.5px;color:var(--mut)}
        .dw-legend{display:flex;gap:6px}
        .dw-legend button{border:1px solid var(--line);background:#fff;border-radius:20px;padding:4px 11px;font-size:12px;font-weight:600;color:var(--mut);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
        .dw-legend button.on{color:var(--ink);border-color:#cbd5e1;background:#f8fafc}
        .dw-legend .sw{width:9px;height:9px;border-radius:50%}
        .dw-chart-wrap{height:260px;width:100%}
        .dw-chart-svg{width:100%;height:100%;display:block}
        .dw-grid{stroke:#eef2f6;stroke-width:1}
        .dw-axis-x,.dw-axis-y{fill:#94a3b8;font-size:11px}.dw-axis-x{text-anchor:middle}
        .dw-feed{list-style:none;margin:0;padding:0;max-height:320px;overflow:auto}
        .dw-feed li{display:flex;gap:11px;align-items:flex-start;padding:9px 2px;border-bottom:1px solid #f1f5f9}
        .dw-feed li:last-child{border-bottom:0}
        .dw-feed a{color:inherit;text-decoration:none;display:flex;gap:11px;width:100%}
        .dw-feed .fi{font-size:15px;line-height:1.4}
        .dw-feed .ft{font-size:13px;flex:1}.dw-feed .fw{font-size:11.5px;color:#94a3b8;white-space:nowrap}
        .dw-todo{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:0 0 22px}
        .dw-todo a,.dw-todo div.na{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:6px}
        .dw-todo a:hover{border-color:var(--g);box-shadow:0 2px 10px rgba(37,211,102,.10)}
        .dw-todo .t-v{font-size:24px;font-weight:750}.dw-todo .t-l{font-size:12.5px;color:var(--mut);font-weight:600}
        .dw-todo .t-go{font-size:11.5px;color:var(--g);font-weight:700}
        .dw-todo div.na .t-v{color:#cbd5e1}
        .dw-camps{display:flex;flex-direction:column;gap:10px}
        .dw-camp{display:grid;grid-template-columns:1fr auto;gap:6px 14px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:13px 15px}
        .dw-camp .cn{font-weight:700;font-size:14px}
        .dw-camp .cm{font-size:12px;color:var(--mut)}
        .dw-bar{grid-column:1/-1;height:7px;background:#eef2f6;border-radius:20px;overflow:hidden}
        .dw-bar span{display:block;height:100%;background:var(--g);border-radius:20px}
        .dw-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;text-transform:capitalize}
        .dw-badge.running{background:rgba(37,211,102,.14);color:#0a7d3f}
        .dw-badge.paused{background:#fef3c7;color:#92400e}.dw-badge.queued{background:#e0f2fe;color:#075985}
        .dw-btn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:7px 13px;font-size:12.5px;font-weight:600;color:var(--ink);text-decoration:none;white-space:nowrap}
        .dw-empty{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:34px 20px;text-align:center;color:#94a3b8;font-size:13.5px}
        .dw-perf{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card)}
        .dw-perf .pc{padding:16px 18px;border-right:1px solid var(--line)}
        .dw-perf .pc:last-child{border-right:0}
        .dw-perf .p-v{font-size:22px;font-weight:750}.dw-perf .p-l{font-size:12px;color:var(--mut);font-weight:600;margin-top:4px}
        .dw-perf .p-na{font-size:13px;color:#cbd5e1;font-weight:600}
        .dw-note{font-size:11.5px;color:#94a3b8;margin:8px 2px 0}
        .dw-sec-h{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin:0 0 12px}
        @media(max-width:1100px){.dw-grid-kpi{grid-template-columns:repeat(3,1fr)}.dw-todo{grid-template-columns:repeat(2,1fr)}.dw-row{grid-template-columns:1fr}.dw-perf{grid-template-columns:repeat(2,1fr)}.dw-perf .pc{border-bottom:1px solid var(--line)}}
        </style>
        <div class="dw-dash">
            <div class="dw-head">
                <div>
                    <h1>WhatsApp Business Center</h1>
                    <p class="dw-sub">Pilotage WhatsApp — uniquement les données de son métier : messagerie et visiteurs arrivés par un lien WhatsApp.</p>
                </div>
                <div class="dw-head-right">
                    <span class="dw-range">
                        <?php foreach ($ranges as $rk => $rl): ?>
                            <a class="<?php echo $p['range'] === $rk ? 'on' : ''; ?>" href="<?php echo esc_url($base . '&range=' . $rk); ?>"><?php echo esc_html($rl); ?></a>
                        <?php endforeach; ?>
                    </span>
                    <span class="dw-conn <?php echo $connected ? 'ok' : 'off'; ?>">
                        <span class="dot"></span>
                        <?php echo $connected ? 'WhatsApp connecté' : 'WhatsApp déconnecté'; ?>
                    </span>
                </div>
            </div>
            <div class="dw-grid-kpi">
                <div class="dw-kpi">
                    <div class="k-top"><span class="k-lab">Contacts</span><span class="k-ic">👥</span></div>
                    <div class="k-val"><?php echo number_format_i18n($d['contacts_total']); ?></div>
                    <div class="k-ctx"><?php echo $d['contacts_new'] > 0 ? '+' . $d['contacts_new'] . ' nouveau(x) · ' . esc_html($p['label']) : 'Aucun nouveau · ' . esc_html($p['label']); ?></div>
                </div>
                <div class="dw-kpi">
                    <div class="k-top"><span class="k-lab">Conversations</span><span class="k-ic">💬</span></div>
                    <div class="k-val"><?php echo number_format_i18n($d['conv']); ?> <?php echo self::dash_delta_html($d['conv'], $d['conv_prev']); ?></div>
                    <div class="k-ctx">Actives · <?php echo esc_html($p['label']); ?></div>
                </div>
                <div class="dw-kpi">
                    <div class="k-top"><span class="k-lab">Messages</span><span class="k-ic">📤</span></div>
                    <div class="k-val"><?php echo number_format_i18n($d['messages']); ?> <?php echo self::dash_delta_html($d['messages'], $d['messages_prev']); ?></div>
                    <div class="k-ctx"><?php echo number_format_i18n($d['sent']); ?> réellement envoyé(s)</div>
                </div>
                <div class="dw-kpi">
                    <div class="k-top"><span class="k-lab">Réponses</span><span class="k-ic">↩️</span></div>
                    <div class="k-val"><?php echo number_format_i18n($d['replies']); ?> <?php echo self::dash_delta_html($d['replies'], $d['replies_prev']); ?></div>
                    <div class="k-ctx"><?php echo $d['reply_rate'] !== null ? 'Taux ' . $d['reply_rate'] . '%' : 'Taux indisponible'; ?></div>
                </div>
                <div class="dw-kpi">
                    <div class="k-top"><span class="k-lab">Clics WhatsApp</span><span class="k-ic">🔗</span></div>
                    <?php if ($wa['available']): ?>
                        <div class="k-val"><?php echo number_format_i18n($wa['clicks']); ?> <?php echo self::dash_delta_html($wa['clicks'], $wa['clicks_prev']); ?></div>
                        <div class="k-ctx">Liens WhatsApp ouverts · <?php echo esc_html($p['label']); ?></div>
                    <?php else: ?>
                        <div class="k-na">Données indisponibles</div>
                        <div class="k-ctx">OmniTracker absent</div>
                    <?php endif; ?>
                </div>
                <div class="dw-kpi">
                    <div class="k-top"><span class="k-lab">Visiteurs via WhatsApp</span><span class="k-ic">🧭</span></div>
                    <?php if ($wa['available']): ?>
                        <div class="k-val"><?php echo number_format_i18n($wa['visitors']); ?> <?php echo self::dash_delta_html($wa['visitors'], $wa['visitors_prev']); ?></div>
                        <div class="k-ctx">Arrivés par un lien WhatsApp</div>
                    <?php else: ?>
                        <div class="k-na">Données indisponibles</div>
                        <div class="k-ctx">OmniTracker absent</div>
                    <?php endif; ?>
                </div>
            </div>
            <div class="dw-row">
                <div class="dw-card2">
                    <div class="c-h">
                        <h2>Activité</h2>
                        <div class="dw-legend" id="dw-legend">
                            <button class="on" data-key="messages"><span class="sw" style="background:#25D366"></span>Messages</button>
                            <button data-key="replies"><span class="sw" style="background:#0ea5e9"></span>Réponses</button>
                            <button data-key="conv"><span class="sw" style="background:#a855f7"></span>Conversations</button>
                        </div>
                    </div>
                    <div class="dw-chart-wrap"><?php echo self::dash_area_svg($series); ?></div>
                    <p class="dw-note">Période : <?php echo esc_html($p['label']); ?> · granularité <?php echo $p['gran'] === 'hour' ? 'horaire' : 'journalière'; ?>.</p>
                </div>
                <div class="dw-card2">
                    <div class="c-h"><h2>Activité récente</h2><span class="c-sub">évènements réels</span></div>
                    <?php if (empty($recent)): ?>
                        <div class="dw-empty">Aucune activité récente.</div>
                    <?php else: ?>
                        <ul class="dw-feed">
                            <?php foreach ($recent as $it): ?>
                                <li><a href="<?php echo esc_url($it['link']); ?>">
                                    <span class="fi"><?php echo $it['icon']; ?></span>
                                    <span class="ft"><?php echo $it['text']; ?></span>
                                    <span class="fw"><?php echo esc_html($it['when']); ?></span>
                                </a></li>
                            <?php endforeach; ?>
                        </ul>
                    <?php endif; ?>
                </div>
            </div>
            <p class="dw-sec-h">À traiter</p>
            <div class="dw-todo">
                <a href="<?php echo esc_url($url('conversations')); ?>">
                    <span class="t-v"><?php echo number_format_i18n($d['awaiting']); ?></span>
                    <span class="t-l">Conversations en attente de réponse</span>
                    <span class="t-go">Ouvrir les conversations →</span>
                </a>
                <a href="<?php echo esc_url($url('conversations')); ?>">
                    <span class="t-v"><?php echo number_format_i18n($d['new_conv']); ?></span>
                    <span class="t-l">Nouvelles conversations (<?php echo esc_html($p['label']); ?>)</span>
                    <span class="t-go">Voir →</span>
                </a>
                <div class="na">
                    <span class="t-v">—</span>
                    <span class="t-l">Conversions attribuées WhatsApp</span>
                    <span class="k-ctx">Données indisponibles (attribution non reliée)</span>
                </div>
                <div class="na">
                    <span class="t-v">—</span>
                    <span class="t-l">Prospects à relancer</span>
                    <span class="k-ctx">Données indisponibles (pas d'attribution)</span>
                </div>
            </div>
            <p class="dw-sec-h">Campagnes actives</p>
            <?php if (empty($campaigns)): ?>
                <div class="dw-empty">Aucune campagne active pour le moment.</div>
            <?php else: ?>
                <div class="dw-camps">
                    <?php foreach ($campaigns as $c):
                        $tot = max(0, (int) $c->total); $snt = (int) $c->sent;
                        $pct = $tot > 0 ? min(100, round($snt / $tot * 100)) : 0;
                        $st  = in_array($c->status, array('running','paused','queued'), true) ? $c->status : 'queued';
                    ?>
                        <div class="dw-camp">
                            <div>
                                <div class="cn"><?php echo esc_html($c->name); ?> <span class="dw-badge <?php echo esc_attr($st); ?>"><?php echo esc_html($c->status); ?></span></div>
                                <div class="cm"><?php echo number_format_i18n($snt); ?> / <?php echo number_format_i18n($tot); ?> envoyé(s)<?php echo (int) $c->failed > 0 ? ' · ' . (int) $c->failed . ' échec(s)' : ''; ?> · <?php echo $pct; ?>%</div>
                            </div>
                            <a class="dw-btn" href="<?php echo esc_url($url('campaigns')); ?>">Voir la campagne</a>
                            <div class="dw-bar"><span style="width:<?php echo $pct; ?>%"></span></div>
                        </div>
                    <?php endforeach; ?>
                </div>
                <p class="dw-note">Réponses et commandes par campagne : indisponibles (aucune attribution enregistrée).</p>
            <?php endif; ?>
            <p class="dw-sec-h">Performance WhatsApp · <?php echo esc_html($p['label']); ?></p>
            <div class="dw-perf">
                <div class="pc">
                    <div class="p-v"><?php echo number_format_i18n($d['sent']); ?></div>
                    <div class="p-l">Messages envoyés</div>
                </div>
                <div class="pc">
                    <div class="p-v"><?php echo number_format_i18n($d['replies']); ?></div>
                    <div class="p-l">Réponses reçues</div>
                </div>
                <div class="pc">
                    <?php if ($wa['available']): ?>
                        <div class="p-v"><?php echo number_format_i18n($wa['clicks']); ?></div>
                        <div class="p-l">Clics WhatsApp</div>
                    <?php else: ?>
                        <div class="p-na">—</div><div class="p-l">Clics WhatsApp</div>
                    <?php endif; ?>
                </div>
                <div class="pc">
                    <?php if ($wa['available']): ?>
                        <div class="p-v"><?php echo number_format_i18n($wa['visitors']); ?></div>
                        <div class="p-l">Visiteurs via WhatsApp</div>
                    <?php else: ?>
                        <div class="p-na">—</div><div class="p-l">Visiteurs via WhatsApp</div>
                    <?php endif; ?>
                </div>
                <div class="pc">
                    <div class="p-na">Indisponible</div>
                    <div class="p-l">Conversions / CA (attribution non reliée)</div>
                </div>
            </div>
            <p class="dw-note">Le Business Center n'affiche que le métier WhatsApp : messagerie (file Sender) et visiteurs arrivés par un lien WhatsApp (via OmniTracker). Aucune donnée globale du site n'est affichée. L'attribution des ventes aux clics WhatsApp n'est pas encore reliée.</p>
            <script>
            (function(){
                var lg=document.getElementById('dw-legend');
                if(!lg)return;
                lg.addEventListener('click',function(e){
                    var b=e.target.closest('button'); if(!b)return;
                    var key=b.getAttribute('data-key');
                    lg.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});
                    document.querySelectorAll('.dw-line,.dw-dot').forEach(function(el){
                        el.style.display=el.getAttribute('data-key')===key?'':'none';
                    });
                });
            })();
            </script>
        </div>

        <?php
    }



    /**
     * Badge CSS d'un statut de commande WooCommerce (réutilise les classes
     * d'état existantes : vert = payé, bleu = en cours, rouge = annulé/échoué).
     */
    /* =====================================================================
     * CRM & CONTACTS — socle de données réel (identité centrale = contact_id)
     * ---------------------------------------------------------------------
     * Le contact_id (Lead ID) est dérivé du téléphone normalisé EXACTEMENT
     * comme le webhook entrant RestApi::handle_inbound_webhook :
     *     'ct_' . substr(md5(clean_phone), 0, 8)
     * => CRM & Contacts, colonne CRM de Conversations et webhook résolvent
     * tous le MÊME enregistrement de {prefix}digiware_whatsapp_contacts.
     * Aucun CRM parallèle : cette table du plugin EST la couche de
     * persistance. L'existence d'un contact vient de l'activité WhatsApp
     * réelle (wasender) ; les champs éditables (statut/tags/segments/notes)
     * sont persistés ici et rien n'est simulé.
     * ===================================================================== */

    /** Téléphone normalisé (chiffres, code international, sans +) — même règle que le webhook. */
    private static function crm_norm_phone($phone) {
        if (class_exists('\\DigiWare\\WhatsApp\\Core\\Normalizer')) {
            return \DigiWare\WhatsApp\Core\Normalizer::clean_phone($phone);
        }
        return preg_replace('/\D/', '', (string) $phone);
    }

    /** Lead ID canonique dérivé du téléphone (identique à handle_inbound_webhook). */
    private static function crm_contact_id_for_phone($phone) {
        $norm = self::crm_norm_phone($phone);
        return $norm === '' ? '' : 'ct_' . substr(md5($norm), 0, 8);
    }

    /** Enregistrement CRM persistant (ou null). tags/segments décodés en tableaux. */
    private static function crm_get_record($contact_id) {
        if ($contact_id === '') { return null; }
        global $wpdb;
        $t = $wpdb->prefix . 'digiware_whatsapp_contacts';
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE contact_id = %s", $contact_id), ARRAY_A);
        if (!$row) { return null; }
        $row['tags']     = array_values(array_filter(array_map('trim', (array) json_decode((string) $row['tags_json'], true))));
        $row['segments'] = array_values(array_filter(array_map('trim', (array) json_decode((string) $row['segments_json'], true))));
        return $row;
    }

    /** Libellés + classes de badge des statuts commerciaux réels et persistables. */
    private static function crm_status_defs() {
        return array(
            'nouveau'    => array('Nouveau',    'dw-st-prospect'),
            'prospect'   => array('Prospect',   'dw-st-prospect'),
            'client'     => array('Client',     'dw-st-actif'),
            'a_relancer' => array('À relancer', 'dw-st-relance'),
            'optout'     => array('Opt-out',    'dw-st-optout'),
        );
    }

    /**
     * Catalogue RÉEL des tags/segments : union du catalogue créé (wp_options,
     * persistant) et des valeurs déjà affectées aux contacts. Aucune donnée fictive.
     */
    private static function crm_label_catalog($kind) {
        global $wpdb;
        $opt = ($kind === 'segment') ? 'digiware_whatsapp_segments' : 'digiware_whatsapp_tags';
        $col = ($kind === 'segment') ? 'segments_json' : 'tags_json';
        $cat = get_option($opt, array());
        if (!is_array($cat)) { $cat = array(); }
        $t = $wpdb->prefix . 'digiware_whatsapp_contacts';
        foreach ((array) $wpdb->get_col("SELECT {$col} FROM {$t}") as $j) {
            foreach ((array) json_decode((string) $j, true) as $v) {
                $v = trim((string) $v);
                if ($v !== '') { $cat[] = $v; }
            }
        }
        $seen = array(); $out = array();
        foreach ($cat as $v) {
            $k = function_exists('mb_strtolower') ? mb_strtolower($v) : strtolower($v);
            if (!isset($seen[$k])) { $seen[$k] = true; $out[] = $v; }
        }
        sort($out, SORT_NATURAL | SORT_FLAG_CASE);
        return $out;
    }
    private static function crm_tag_catalog()     { return self::crm_label_catalog('tag'); }
    private static function crm_segment_catalog() { return self::crm_label_catalog('segment'); }

    // __CRM_INDEX_HELPERS__

    /** Index téléphone→commandes WooCommerce (payées/total/CA/produits) construit UNE seule fois. */
    private static function crm_wc_index() {
        static $idx = null;
        if ($idx !== null) { return $idx; }
        $idx = array();
        if (!function_exists('wc_get_orders')) { return $idx; }
        $orders = wc_get_orders(array('limit' => -1, 'orderby' => 'date', 'order' => 'DESC'));
        foreach ($orders as $o) {
            if (!is_object($o)) { continue; }
            $ph = self::crm_norm_phone($o->get_billing_phone());
            if ($ph === '') { continue; }
            if (!isset($idx[$ph])) {
                $idx[$ph] = array('total'=>0,'paid'=>0,'sum'=>0.0,'currency'=>'','last_product'=>'','last_ts'=>0,'products'=>array(),'orders'=>array());
            }
            $idx[$ph]['total']++;
            $status = $o->get_status();
            if (in_array($status, array('completed','processing'), true)) {
                $idx[$ph]['paid']++;
                $idx[$ph]['sum'] += (float) $o->get_total();
            }
            if ($idx[$ph]['currency'] === '') { $idx[$ph]['currency'] = $o->get_currency(); }
            $first = ''; $nb = 0;
            foreach ($o->get_items() as $it) {
                $nb++; $pn = $it->get_name();
                if ($first === '') { $first = $pn; }
                if (!isset($idx[$ph]['products'][$pn])) { $idx[$ph]['products'][$pn] = 0; }
                $idx[$ph]['products'][$pn] += (int) $it->get_quantity();
            }
            $ts = $o->get_date_created() ? $o->get_date_created()->getTimestamp() : 0;
            if ($ts > $idx[$ph]['last_ts']) { $idx[$ph]['last_ts'] = $ts; $idx[$ph]['last_product'] = $first; }
            if (count($idx[$ph]['orders']) < 8) {
                $idx[$ph]['orders'][] = array('number'=>$o->get_order_number(),'product'=>$first,'items'=>$nb,'total'=>(float)$o->get_total(),'currency'=>$o->get_currency(),'status'=>$status,'url'=>$o->get_edit_order_url(),'ts'=>$ts);
            }
        }
        return $idx;
    }

    /** Index téléphone→user_id WordPress (métas de facturation) construit UNE seule fois. */
    private static function crm_user_index() {
        static $idx = null;
        if ($idx !== null) { return $idx; }
        global $wpdb;
        $idx = array();
        $rows = $wpdb->get_results(
            "SELECT user_id, meta_value FROM {$wpdb->usermeta}
             WHERE meta_key IN ('billing_phone','phone','telephone','digits_phone','account_phone')
               AND meta_value <> ''", ARRAY_A);
        foreach ((array) $rows as $r) {
            $ph = self::crm_norm_phone($r['meta_value']);
            if ($ph !== '' && !isset($idx[$ph])) { $idx[$ph] = (int) $r['user_id']; }
        }
        return $idx;
    }
    // __CRM_COLLECT__

    /** Enrichit un téléphone normalisé avec l'utilisateur WP relié (nom/email/…). */
    private static function crm_wp_enrich($norm) {
        $r = array('user_id'=>0,'name'=>'','email'=>'','company'=>'','city'=>'','profession'=>'');
        $usr = self::crm_user_index();
        if (!isset($usr[$norm])) { return $r; }
        $uid = $usr[$norm];
        $u = get_user_by('id', $uid);
        $bf = get_user_meta($uid,'billing_first_name',true);
        $bl = get_user_meta($uid,'billing_last_name',true);
        $name = trim($bf.' '.$bl);
        if ($name === '' && $u) { $name = trim($u->first_name.' '.$u->last_name); if ($name==='') { $name = (string) $u->display_name; } }
        $email = get_user_meta($uid,'billing_email',true); if (!$email && $u) { $email = $u->user_email; }
        $prof = get_user_meta($uid,'profession',true); if (!$prof) { $prof = get_user_meta($uid,'job_title',true); }
        $r = array(
            'user_id'    => $uid,
            'name'       => $name,
            'email'      => $email,
            'company'    => get_user_meta($uid,'billing_company',true),
            'city'       => get_user_meta($uid,'billing_city',true),
            'profession' => $prof,
        );
        return $r;
    }

    /** Liste unifiée des contacts CRM : activité WhatsApp réelle + WooCommerce + persistance CRM. */
    private static function crm_collect_contacts() {
        global $wpdb;
        $replies = $wpdb->prefix . 'wasender_replies';
        $jobs    = $wpdb->prefix . 'wasender_jobs';
        $wa = $wpdb->get_results(
            "SELECT phone, MAX(last_seen) last_seen, SUM(msg_count) msg_count, SUM(in_count) in_count, MAX(optout) optout
             FROM ( SELECT REPLACE(REPLACE(phone,'+',''),' ','') phone, received_at last_seen, 1 msg_count, 1 in_count, is_optout optout FROM {$replies}
                    UNION ALL SELECT REPLACE(REPLACE(phone,'+',''),' ','') phone, updated_at last_seen, 1 msg_count, 0 in_count, 0 optout FROM {$jobs} ) t
             WHERE phone <> '' GROUP BY phone ORDER BY last_seen DESC LIMIT 1000", ARRAY_A);

        $wc = self::crm_wc_index();
        $recs = array();
        $t = $wpdb->prefix . 'digiware_whatsapp_contacts';
        foreach ((array) $wpdb->get_results("SELECT * FROM {$t}", ARRAY_A) as $r) { $recs[$r['contact_id']] = $r; }

        $out = array(); $seen = array();
        $build = function($norm, $wa_row) use (&$out, &$seen, $wc, $recs) {
            if ($norm === '' || isset($seen[$norm])) { return; }
            $seen[$norm] = true;
            $cid = 'ct_' . substr(md5($norm), 0, 8);
            $rec = isset($recs[$cid]) ? $recs[$cid] : null;
            $wp  = self::crm_wp_enrich($norm);
            $name = $wp['name']; $email = $wp['email']; $company = $wp['company']; $city = $wp['city']; $prof = $wp['profession'];
            if ($rec) {
                $rn = trim($rec['first_name'].' '.$rec['last_name']);
                if ($rn !== '')                   { $name = $rn; }
                if (!empty($rec['email']))         { $email = $rec['email']; }
                if (!empty($rec['company']))       { $company = $rec['company']; }
                if (!empty($rec['city']))          { $city = $rec['city']; }
                if (!empty($rec['profession']))    { $prof = $rec['profession']; }
            }
            $o = isset($wc[$norm]) ? $wc[$norm] : null;
            $orders_paid  = $o ? (int) $o['paid']  : 0;
            $orders_total = $o ? (int) $o['total'] : 0;
            $optout = $wa_row ? ((int) $wa_row['optout'] > 0) : false;
            if ($rec && !empty($rec['commercial_status'])) { $status = $rec['commercial_status']; $status_src = 'persisted'; }
            elseif ($optout)          { $status = 'optout';   $status_src = 'auto'; }
            elseif ($orders_paid > 0) { $status = 'client';   $status_src = 'auto'; }
            else                      { $status = 'prospect'; $status_src = 'auto'; }
            $tags = $rec ? array_values(array_filter(array_map('trim', (array) json_decode((string) $rec['tags_json'], true)))) : array();
            $segments = $rec ? array_values(array_filter(array_map('trim', (array) json_decode((string) $rec['segments_json'], true)))) : array();
            $out[] = array(
                'contact_id'=>$cid,'norm'=>$norm,'display'=>'+'.$norm,'name'=>$name,'email'=>$email,'company'=>$company,'city'=>$city,'profession'=>$prof,'user_id'=>$wp['user_id'],
                'msg_count'=>$wa_row?(int)$wa_row['msg_count']:0,'in_count'=>$wa_row?(int)$wa_row['in_count']:0,'optout'=>$optout,
                'orders_total'=>$orders_total,'orders_paid'=>$orders_paid,'orders_sum'=>$o?(float)$o['sum']:0.0,'currency'=>$o?$o['currency']:'',
                'status'=>$status,'status_src'=>$status_src,'tags'=>$tags,'segments'=>$segments,'has_record'=>(bool)$rec,
                'last_seen'=>$wa_row?$wa_row['last_seen']:($rec?$rec['updated_at']:''),'created'=>$rec?$rec['created_at']:'',
            );
        };
        foreach ((array) $wa as $r) { $build(self::crm_norm_phone($r['phone']), $r); }
        foreach ($recs as $cid => $r) {
            $norm = self::crm_norm_phone($r['phone']);
            if ($norm === '' || isset($seen[$norm])) { continue; }
            $build($norm, null);
        }
        return $out;
    }

    /** Derniers évènements de messagerie réels pour un téléphone (fiche CRM). */
    private static function crm_phone_thread($norm, $limit = 8) {
        global $wpdb;
        $replies = $wpdb->prefix . 'wasender_replies';
        $jobs    = $wpdb->prefix . 'wasender_jobs';
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT dir, st, at FROM (
                SELECT 'in' dir, CASE WHEN is_optout=1 THEN 'opt-out' ELSE 'reply' END st, received_at at, REPLACE(REPLACE(phone,'+',''),' ','') norm FROM {$replies}
                UNION ALL
                SELECT 'out' dir, 'sent' st, COALESCE(sent_at, created_at, updated_at) at, REPLACE(REPLACE(phone,'+',''),' ','') norm FROM {$jobs}
             ) t WHERE norm = %s ORDER BY at DESC LIMIT %d", $norm, $limit), ARRAY_A);
        return (array) $rows;
    }
    // __CRM_RENDER__

    private static function conv_order_badge($status) {
        if (in_array($status, array('completed', 'processing'), true))            { return 'dw-st-actif'; }
        if (in_array($status, array('failed', 'cancelled', 'refunded'), true))    { return 'dw-st-optout'; }
        return 'dw-st-prospect';
    }

    /**
     * Enrichissement RÉEL de la fiche contextuelle du contact affiché dans
     * Conversations. Ne fabrique aucune donnée : lit l'utilisateur WordPress
     * relié par téléphone (profil de facturation) et ses commandes WooCommerce
     * (source unique produits/commandes, via wc_get_orders — HPOS). Toute
     * section sans donnée réelle reste vide et l'affichage l'indique.
     *
     * @param string $phone_display Numéro tel que stocké (peut contenir « + »)
     * @param string $digits        Numéro normalisé (chiffres uniquement)
     * @param array  $thread        Fil de la conversation (dir/body/st/at)
     * @return array
     */
    private static function conv_contact_card($phone_display, $digits, $thread) {
        global $wpdb;
        $card = array(
            'user_id' => 0, 'edit_url' => '', 'name' => '', 'profile' => array(),
            'has_wc' => function_exists('wc_get_orders'),
            'orders' => array(), 'orders_total' => 0, 'orders_paid' => 0,
            'orders_sum' => 0.0, 'currency' => '', 'products' => array(), 'activity' => array(),
        );

        // 1) Utilisateur WordPress relié par téléphone (métas de facturation).
        if ($digits !== '') {
            $uid = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT user_id FROM {$wpdb->usermeta}
                 WHERE meta_key IN ('billing_phone','phone','telephone','digits_phone','account_phone')
                   AND REPLACE(REPLACE(REPLACE(meta_value,'+',''),' ',''),'-','') = %s
                 ORDER BY user_id ASC LIMIT 1",
                $digits
            ));
            if ($uid > 0 && ($u = get_user_by('id', $uid))) {
                $card['user_id']  = $uid;
                $card['edit_url'] = get_edit_user_link($uid);
                $bf = get_user_meta($uid, 'billing_first_name', true);
                $bl = get_user_meta($uid, 'billing_last_name', true);
                $name = trim($bf . ' ' . $bl);
                if ($name === '') { $name = trim($u->first_name . ' ' . $u->last_name); }
                if ($name === '') { $name = (string) $u->display_name; }
                $card['name'] = $name;
                $email   = get_user_meta($uid, 'billing_email', true); if (!$email) { $email = $u->user_email; }
                $company = get_user_meta($uid, 'billing_company', true);
                $city    = get_user_meta($uid, 'billing_city', true);
                $prof    = get_user_meta($uid, 'profession', true); if (!$prof) { $prof = get_user_meta($uid, 'job_title', true); }
                if ($email)   { $card['profile']['Email']      = $email; }
                if ($company) { $card['profile']['Entreprise'] = $company; }
                if ($prof)    { $card['profile']['Profession'] = $prof; }
                if ($city)    { $card['profile']['Ville']      = $city; }
            }
        }
        // 2) Commandes WooCommerce du contact (source unique, HPOS via wc_get_orders).
        if ($card['has_wc'] && $digits !== '') {
            $variants = array();
            foreach (array((string) $phone_display, '+' . $digits, $digits) as $v) {
                if ($v !== '' && !in_array($v, $variants, true)) { $variants[] = $v; }
            }
            $order_ids = array();
            foreach ($variants as $v) {
                $r = wc_get_orders(array('limit' => -1, 'return' => 'ids', 'orderby' => 'date', 'order' => 'DESC', 'billing_phone' => $v));
                if (!empty($r)) { $order_ids = $r; break; }
            }
            foreach ($order_ids as $oid) {
                $o = wc_get_order($oid);
                if (!$o) { continue; }
                $card['orders_total']++;
                $status = $o->get_status();
                if (in_array($status, array('completed', 'processing'), true)) {
                    $card['orders_paid']++;
                    $card['orders_sum'] += (float) $o->get_total();
                }
                if ($card['currency'] === '') { $card['currency'] = $o->get_currency(); }
                $first_item = ''; $nb_items = 0;
                foreach ($o->get_items() as $it) {
                    $pn = $it->get_name(); $nb_items++;
                    if ($first_item === '') { $first_item = $pn; }
                    if (!isset($card['products'][$pn])) { $card['products'][$pn] = 0; }
                    $card['products'][$pn] += (int) $it->get_quantity();
                }
                $ots = $o->get_date_created() ? $o->get_date_created()->getTimestamp() : 0;
                if (count($card['orders']) < 6) {
                    $card['orders'][] = array(
                        'number' => $o->get_order_number(), 'product' => $first_item, 'items' => $nb_items,
                        'total' => (float) $o->get_total(), 'currency' => $o->get_currency(),
                        'status' => $status, 'url' => $o->get_edit_order_url(),
                    );
                    $card['activity'][] = array('ts' => $ots, 'icon' => '🛒', 'text' => 'Commande #' . $o->get_order_number() . ' · ' . wc_get_order_status_name($status));
                }
            }
        }

        // 3) Timeline compacte : derniers évènements de messagerie réels + commandes.
        $msg_events = array();
        foreach ($thread as $m) {
            $ts = strtotime(((string) $m['at']) . ' UTC');
            if ($m['dir'] === 'in') {
                $msg_events[] = array('ts' => $ts, 'icon' => $m['st'] === 'opt-out' ? '⛔' : '↩️', 'text' => $m['st'] === 'opt-out' ? 'Désinscription (opt-out)' : 'Réponse reçue');
            } else {
                $msg_events[] = array('ts' => $ts, 'icon' => '📤', 'text' => 'Message envoyé');
            }
        }
        $msg_events = array_slice(array_reverse($msg_events), 0, 5);
        $card['activity'] = array_merge($card['activity'], $msg_events);
        usort($card['activity'], function($a, $b) { return $b['ts'] - $a['ts']; });
        $card['activity'] = array_slice($card['activity'], 0, 6);

        // 4) Fiche CRM persistante partagée (MÊME enregistrement que l'onglet CRM & Contacts).
        //    Identité centrale = contact_id dérivé du téléphone (règle du webhook entrant).
        $card['crm_id']         = self::crm_contact_id_for_phone($phone_display !== '' ? $phone_display : $digits);
        $card['crm_status']     = '';
        $card['crm_status_src'] = 'auto';
        $card['crm_tags']       = array();
        $card['crm_segments']   = array();
        $card['crm_notes']      = '';
        $card['crm_has_record'] = false;
        $rec = self::crm_get_record($card['crm_id']);
        if ($rec) {
            $card['crm_has_record'] = true;
            $card['crm_tags']       = $rec['tags'];
            $card['crm_segments']   = $rec['segments'];
            $card['crm_notes']      = (string) $rec['notes'];
            if (!empty($rec['commercial_status'])) { $card['crm_status'] = $rec['commercial_status']; $card['crm_status_src'] = 'persisted'; }
            // Le nom persisté CRM prime s'il existe et qu'aucun nom WP n'a été trouvé.
            if ($card['name'] === '') {
                $rn = trim($rec['first_name'].' '.$rec['last_name']);
                if ($rn !== '') { $card['name'] = $rn; }
            }
        }
        // Statut objectif de repli si non qualifié manuellement (jamais persisté ici).
        if ($card['crm_status'] === '') {
            if ($card['orders_paid'] > 0) { $card['crm_status'] = 'client'; }
            else                          { $card['crm_status'] = 'prospect'; }
        }

        return $card;
    }

    private static function render_conversations_tab($sender_health) {
        global $wpdb;
        $replies_table = $wpdb->prefix . 'wasender_replies';
        $jobs_table    = $wpdb->prefix . 'wasender_jobs';

        $active = isset($_GET['thread']) ? preg_replace('/[^0-9]/', '', $_GET['thread']) : '';
        $status = isset($_GET['status']) ? sanitize_key($_GET['status']) : '';

        // Liste réelle des conversations : numéros distincts (jobs sortants + réponses entrantes).
        // On normalise le numéro (sans +, sans espaces) pour éviter les doublons du même contact.
        $rows = $wpdb->get_results(
            "SELECT MAX(phone) AS phone, MAX(t) AS last_at, SUM(inbound) AS in_count,
                    SUBSTRING_INDEX(GROUP_CONCAT(last_body ORDER BY t DESC SEPARATOR '\\n\\n'), '\\n\\n', 1) AS last_body
             FROM (
                SELECT REPLACE(REPLACE(phone,'+',''),' ','') AS norm, phone, COALESCE(sent_at, created_at, updated_at) AS t, 0 AS inbound, message_final AS last_body FROM {$jobs_table}
                UNION ALL
                SELECT REPLACE(REPLACE(phone,'+',''),' ','') AS norm, phone, received_at AS t, 1 AS inbound, message AS last_body FROM {$replies_table}
             ) u GROUP BY norm ORDER BY last_at DESC LIMIT 100",
            ARRAY_A
        );

        if ($active === '' && !empty($rows)) {
            $active = preg_replace('/[^0-9]/', '', $rows[0]['phone']);
        }

        // Fil de la conversation active
        $thread = array();
        $active_phone_display = $active;
        if ($active !== '') {
            $thread = $wpdb->get_results($wpdb->prepare(
                "SELECT dir, body, st, at FROM (
                    SELECT 'out' AS dir, message_final AS body, status AS st, COALESCE(sent_at, created_at, updated_at) AS at FROM {$jobs_table} WHERE REPLACE(REPLACE(phone,'+',''),' ','') = %s
                    UNION ALL
                    SELECT 'in' AS dir, message AS body, CASE WHEN is_optout=1 THEN 'opt-out' ELSE 'recu' END AS st, received_at AS at FROM {$replies_table} WHERE REPLACE(REPLACE(phone,'+',''),' ','') = %s
                 ) t ORDER BY at ASC",
                $active, $active
            ), ARRAY_A);
            $p = $wpdb->get_var($wpdb->prepare("SELECT phone FROM {$jobs_table} WHERE REPLACE(REPLACE(phone,'+',''),' ','') = %s LIMIT 1", $active));
            if (!$p) { $p = $wpdb->get_var($wpdb->prepare("SELECT phone FROM {$replies_table} WHERE REPLACE(REPLACE(phone,'+',''),' ','') = %s LIMIT 1", $active)); }
            if ($p) { $active_phone_display = $p; }
        }

        // --- Bloc 1 : chiffres réels pour les cartes KPI (aucune donnée inventée) ---
        $today     = current_time('Y-m-d');
        $k_convos  = count($rows);
        $k_sent    = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$jobs_table} WHERE status IN ('sent','delivered','read')");
        $k_replies = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$replies_table}");
        $k_pending = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$jobs_table} WHERE status IN ('queued','processing','held_undelivered')");
        $convos_with_reply = 0;
        foreach ($rows as $r) { if ((int) $r['in_count'] > 0) { $convos_with_reply++; } }
        $k_rate = $k_convos > 0 ? (int) round($convos_with_reply / $k_convos * 100) : 0;
        // Variations du jour
        $d_sent    = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$jobs_table} WHERE status IN ('sent','delivered','read') AND DATE(updated_at) = %s", $today));
        $d_replies = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$replies_table} WHERE DATE(received_at) = %s", $today));
        $d_convos  = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(DISTINCT phone) FROM (SELECT phone, updated_at AS t FROM {$jobs_table} UNION ALL SELECT phone, received_at AS t FROM {$replies_table}) x WHERE DATE(t) = %s", $today));
        ?>
        <?php if ($status === 'queued'): ?>
            <div class="notice notice-success" style="margin:0 0 14px;"><p>Réponse ajoutée à la file d'attente : la « main » Node l'enverra sous peu.</p></div>
        <?php elseif ($status === 'failed'): ?>
            <div class="notice notice-error" style="margin:0 0 14px;"><p>Échec : message vide ou file indisponible.</p></div>
        <?php endif; ?>

        <!-- Bloc 1 : rangée de cartes KPI (données réelles) -->
        <div class="dw-kpi-row">
            <div class="dw-kpi">
                <div class="dw-kpi-ico dw-ico-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></div>
                <div class="dw-kpi-body">
                    <span class="dw-kpi-label">Conversations</span>
                    <span class="dw-kpi-num"><?php echo (int) $k_convos; ?></span>
                    <?php if ($d_convos > 0): ?><span class="dw-kpi-delta up">↑ +<?php echo $d_convos; ?> aujourd'hui</span><?php else: ?><span class="dw-kpi-delta flat">Aucune aujourd'hui</span><?php endif; ?>
                </div>
            </div>
            <div class="dw-kpi">
                <div class="dw-kpi-ico dw-ico-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg></div>
                <div class="dw-kpi-body">
                    <span class="dw-kpi-label">Réponses reçues</span>
                    <span class="dw-kpi-num"><?php echo (int) $k_replies; ?></span>
                    <?php if ($d_replies > 0): ?><span class="dw-kpi-delta up">↑ +<?php echo $d_replies; ?> aujourd'hui</span><?php else: ?><span class="dw-kpi-delta flat">Aucune aujourd'hui</span><?php endif; ?>
                </div>
            </div>
            <div class="dw-kpi">
                <div class="dw-kpi-ico dw-ico-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg></div>
                <div class="dw-kpi-body">
                    <span class="dw-kpi-label">Messages envoyés</span>
                    <span class="dw-kpi-num"><?php echo (int) $k_sent; ?></span>
                    <?php if ($d_sent > 0): ?><span class="dw-kpi-delta up">↑ +<?php echo $d_sent; ?> aujourd'hui</span><?php else: ?><span class="dw-kpi-delta flat">Aucun aujourd'hui</span><?php endif; ?>
                </div>
            </div>
            <div class="dw-kpi">
                <div class="dw-kpi-ico dw-ico-amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
                <div class="dw-kpi-body">
                    <span class="dw-kpi-label">En attente</span>
                    <span class="dw-kpi-num"><?php echo (int) $k_pending; ?></span>
                    <?php if ($k_pending > 0): ?><span class="dw-kpi-delta up"><?php echo $k_pending; ?> en file</span><?php else: ?><span class="dw-kpi-delta flat">Aucun</span><?php endif; ?>
                </div>
            </div>
            <div class="dw-kpi">
                <div class="dw-kpi-ico dw-ico-violet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 6 13.5 15.5 8.5 10.5 1 18"/><path d="M17 6h6v6"/></svg></div>
                <div class="dw-kpi-body">
                    <span class="dw-kpi-label">Taux de réponse</span>
                    <span class="dw-kpi-num"><?php echo (int) $k_rate; ?>%</span>
                    <span class="dw-kpi-delta flat"><?php echo $convos_with_reply; ?>/<?php echo $k_convos; ?> conversations</span>
                </div>
            </div>
        </div>

        <div class="dw-chat-container">
            <!-- Liste réelle des conversations -->
            <div class="dw-chat-list">
                <!-- Recherche -->
                <div class="dw-conv-search">
                    <div class="dw-conv-search-box">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        <input type="text" id="dw-conv-search-input" placeholder="Rechercher une conversation..." autocomplete="off" />
                    </div>
                    <button type="button" class="dw-conv-filterbtn" id="dw-conv-filterbtn" title="Filtrer les non-lues"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg></button>
                </div>
                <!-- Filtres -->
                <div class="dw-conv-tabs">
                    <button type="button" class="dw-conv-tab active" data-filter="all">Toutes (<?php echo (int) $k_convos; ?>)</button>
                    <button type="button" class="dw-conv-tab" data-filter="unread">Non lues (<?php echo (int) $convos_with_reply; ?>)<?php if ($convos_with_reply > 0): ?><span class="dot"></span><?php endif; ?></button>
                    <button type="button" class="dw-conv-tab" data-filter="important">Importantes</button>
                    <button type="button" class="dw-conv-tab" data-filter="archived">Archivées</button>
                </div>
                <!-- Liste -->
                <?php if (empty($rows)): ?>
                    <div class="dw-conv-empty-filter">Aucune conversation pour le moment. Les numéros apparaîtront ici dès le premier envoi ou la première réponse.</div>
                <?php else: foreach ($rows as $r):
                    $digits = preg_replace('/[^0-9]/', '', $r['phone']);
                    $is_active = ($digits === $active);
                    $url = add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'conversations','thread'=>$digits), admin_url('admin.php'));
                    $unread = ((int) $r['in_count'] > 0) ? '1' : '0';
                    $snip = mb_substr((string) $r['last_body'], 0, 60);
                    $ava = substr($digits, -2);
                    $search_key = strtolower($digits . ' ' . $r['phone'] . ' ' . $snip);
                ?>
                    <a href="<?php echo esc_url($url); ?>" class="dw-conv-item<?php echo $is_active ? ' active' : ''; ?>" data-unread="<?php echo $unread; ?>" data-phone="<?php echo esc_attr($digits); ?>" data-search="<?php echo esc_attr($search_key); ?>">
                        <div class="dw-conv-ava"><?php echo esc_html($ava); ?></div>
                        <div class="dw-conv-body">
                            <div class="dw-conv-top">
                                <span class="dw-conv-name"><?php echo esc_html($r['phone']); ?></span>
                                <span class="dw-conv-time"><?php echo esc_html(self::fmt_time($r['last_at'], 'd/m H:i')); ?></span>
                            </div>
                            <div class="dw-conv-snippet"><?php echo esc_html($snip); ?></div>
                        </div>
                        <?php if ((int) $r['in_count'] > 0): ?><span class="dw-conv-badge"><?php echo (int) $r['in_count']; ?></span><?php endif; ?>
                    </a>
                <?php endforeach; endif; ?>
                <div class="dw-conv-empty-filter" id="dw-conv-empty" style="display:none;">Aucune conversation ne correspond à ce filtre.</div>
            </div>

            <!-- Fil actif réel -->
            <div class="dw-chat-main">
                <div class="dw-chat-head">
                    <?php if ($active_phone_display && $active !== ''): ?>
                    <div class="dw-chat-head-l">
                        <div class="dw-chat-head-ava"><?php echo esc_html(substr(preg_replace('/[^0-9]/', '', $active_phone_display), -2)); ?></div>
                        <div>
                            <div class="dw-chat-head-name"><?php echo esc_html($active_phone_display); ?></div>
                            <div class="dw-chat-head-status"><span style="width:7px;height:7px;border-radius:50%;background:#10b981;display:inline-block;"></span> En ligne sur WhatsApp</div>
                        </div>
                    </div>
                    <div class="dw-chat-head-actions" id="dw-head-actions" data-phone="<?php echo esc_attr($active); ?>">
                        <button type="button" class="dw-chat-hbtn" id="dw-btn-refresh" title="Actualiser ce chat maintenant"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
                        <button type="button" class="dw-chat-hbtn" id="dw-btn-copy" title="Copier la conversation (avec horodatage)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        <button type="button" class="dw-chat-hbtn" id="dw-btn-fav" title="Marquer comme important"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>
                        <button type="button" class="dw-chat-hbtn" id="dw-btn-tag" title="Ouvrir la fiche CRM de ce contact"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
                        <button type="button" class="dw-chat-hbtn" id="dw-btn-arch" title="Archiver cette conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg></button>
                        <button type="button" class="dw-chat-hbtn" id="dw-btn-call" title="Ouvrir WhatsApp / appeler ce numéro"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></button>
                    </div>
                    <?php else: ?>
                    <strong style="font-size:15px;color:#0f172a;font-family:monospace;">Aucune conversation</strong>
                    <?php endif; ?>
                </div>
                <div class="dw-chat-messages">
                    <?php if (empty($thread)): ?>
                        <div style="color:#64748b;font-size:13px;padding:20px;">Sélectionnez une conversation à gauche.</div>
                    <?php else:
                        $dw_last_date = '';
                        foreach ($thread as $m):
                            $out = ($m['dir'] === 'out');
                            $dw_date = self::fmt_time($m['at'], 'j F Y');
                            if ($dw_date !== $dw_last_date):
                                $dw_last_date = $dw_date; ?>
                        <div class="dw-date-sep"><?php echo esc_html($dw_date); ?></div>
                    <?php endif; ?>
                        <div class="dw-msg-bubble <?php echo $out ? 'dw-msg-outbound' : 'dw-msg-inbound'; ?>" data-at="<?php echo esc_attr((string) $m['at']); ?>" data-dir="<?php echo $out ? 'out' : 'in'; ?>" data-st="<?php echo esc_attr((string) $m['st']); ?>">
                            <div><?php echo nl2br(esc_html((string) $m['body'])); ?></div>
                            <div class="dw-msg-meta" style="color:<?php echo $out ? '#059669' : '#94a3b8'; ?>;">
                                <span><?php echo esc_html(self::fmt_time($m['at'], 'H:i')); ?></span>
                                <?php if ($out):
                                    $st = (string) $m['st'];
                                    if ($st === 'read'): ?>
                                        <span class="dw-tick" title="Lu" style="color:#34b7f1;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7 8.5 16.5 5 13"/><path d="M22 7 12.5 16.5"/></svg></span>
                                    <?php elseif ($st === 'delivered'): ?>
                                        <span class="dw-tick" title="Livré" style="color:#94a3b8;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7 8.5 16.5 5 13"/><path d="M22 7 12.5 16.5"/></svg></span>
                                    <?php else: ?>
                                        <span class="dw-tick" title="Envoyé" style="color:#94a3b8;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7 9 18l-5-5"/></svg></span>
                                    <?php endif;
                                endif; ?>
                            </div>
                        </div>
                    <?php endforeach; endif; ?>
                </div>

                <div class="dw-chat-input-area">
                    <?php if ($active_phone_display && $active !== ''): ?>
                    <form method="POST" id="dw-conv-form" data-phone="<?php echo esc_attr($active_phone_display); ?>">
                        <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                        <input type="hidden" name="dw_wa_action" value="send_direct_message" />
                        <input type="hidden" name="recipient_phone" value="<?php echo esc_attr($active_phone_display); ?>" />
                        <div class="dw-attach-chip" id="dw-attach-chip"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg><span id="dw-attach-name"></span><button type="button" id="dw-attach-clear" title="Retirer">✕</button></div>
                        <input type="file" id="dw-file-input" style="display:none;" />
                        <div class="dw-input-wrap">
                            <div class="dw-input-toolbar">
                                <button type="button" class="dw-input-icon" id="dw-emoji-btn" title="Émoji"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
                                <button type="button" class="dw-input-icon dw-media-btn" data-accept="*/*" title="Pièce jointe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
                                <button type="button" class="dw-input-icon dw-media-btn" data-accept="image/*" title="Image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></button>
                                <button type="button" class="dw-input-icon dw-media-btn" data-accept=".pdf,.doc,.docx,.xls,.xlsx,.csv" title="Document"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></button>
                            </div>
                            <textarea name="message_content" id="dw-msg-input" rows="1" class="dw-input-field" placeholder="Écrivez votre message..." required></textarea>
                            <button type="button" class="dw-templates-btn" id="dw-tpl-btn" title="Insérer un modèle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg><span>Templates</span></button>
                            <button type="submit" class="dw-send-btn" title="Envoyer (mise en file d'envoi)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
                            <div class="dw-pop" id="dw-emoji-pop"><div class="dw-emoji-grid" id="dw-emoji-grid"></div></div>
                            <div class="dw-pop dw-tpl-pop" id="dw-tpl-pop"></div>
                        </div>
                    </form>
                    <?php else: ?>
                        <div style="color:#64748b;font-size:12px;">Aucun numéro sélectionné.</div>
                    <?php endif; ?>
                </div>
            </div>

            <!-- Bloc 2 : fiche contextuelle CRM du contact (colonne de droite) -->
            <div class="dw-chat-crm">
                <?php if ($active_phone_display && $active !== ''):
                    $c_total   = count($thread);
                    $c_replies = 0; $c_optout = false;
                    foreach ($thread as $m) { if ($m['dir'] === 'in') { $c_replies++; if ($m['st'] === 'opt-out') { $c_optout = true; } } }
                    $c_last    = !empty($thread) ? $thread[count($thread) - 1]['at'] : '';
                    if ($c_optout)          { $st_cls = 'dw-st-optout';   $st_lbl = 'Opt-out'; }
                    elseif ($c_replies > 0) { $st_cls = 'dw-st-actif';    $st_lbl = 'Actif'; }
                    else                    { $st_cls = 'dw-st-prospect'; $st_lbl = 'Prospect'; }

                    $card     = self::conv_contact_card($active_phone_display, $active, $thread);
                    $has_name = $card['name'] !== '';
                    $ident    = $has_name ? $card['name'] : $active_phone_display;
                    $initials = $has_name ? strtoupper(mb_substr($card['name'], 0, 1)) : substr(preg_replace('/[^0-9]/', '', $active_phone_display), -2);
                    $crm_url  = esc_url(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm'), admin_url('admin.php')));
                    $fiche_url = esc_url(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm','contact'=>$card['crm_id'],'phone'=>$active), admin_url('admin.php')));
                    $sd       = self::crm_status_defs();
                    $jrn_url  = esc_url(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'activity'), admin_url('admin.php')));
                    $wa_link  = 'https://wa.me/' . rawurlencode($active);
                    $tz       = self::dash_tz_offset();
                    $fmt_ts   = function($ts) use ($tz) { return $ts > 0 ? date_i18n('d/m/Y H:i', $ts + $tz, true) : '—'; };
                ?>
                <!-- 1. EN-TÊTE CONTACT -->
                <div class="dw-crm-head">
                    <span class="dw-crm-title">Fiche contact</span>
                    <div class="dw-crm-head-btns">
                        <a class="dw-crm-editbtn" href="<?php echo $fiche_url; ?>" title="Ouvrir la fiche CRM complète (modifier statut, tags, notes)">✏ Modifier</a>
                        <a class="dw-crm-menu" href="<?php echo $fiche_url; ?>" title="Ouvrir dans le CRM">⋯</a>
                    </div>
                </div>
                <div class="dw-crm-avatar-wrap">
                    <div class="dw-crm-avatar"><?php echo esc_html($initials); ?></div>
                    <div class="dw-crm-name"><?php echo esc_html($ident); ?></div>
                    <?php if ($has_name): ?><div class="dw-crm-phone-sub"><?php echo esc_html($active_phone_display); ?></div><?php endif; ?>
                    <div class="dw-crm-online"><span style="width:7px;height:7px;border-radius:50%;background:#10b981;"></span> Contact WhatsApp</div>
                </div>
                <!-- 2. ACTIONS RAPIDES -->
                <div class="dw-crm-actions">
                    <div class="dw-crm-action" onclick="var t=document.getElementById('dw-msg-input'); if(t){t.focus();}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Message</div>
                    <div class="dw-crm-action" onclick="window.open('<?php echo esc_js($wa_link); ?>','_blank');" title="Ouvrir la discussion dans WhatsApp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>Appel</div>
                    <div class="dw-crm-action" onclick="window.location.href='<?php echo $crm_url; ?>';" title="Ouvrir la fiche CRM"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.59a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>Tag / CRM</div>
                    <div class="dw-crm-action" onclick="window.location.href='<?php echo $jrn_url; ?>';" title="Voir le journal & la traçabilité"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>Journal</div>
                </div>
                <!-- 3. PROFIL -->
                <div class="dw-crm-section-title">Profil</div>
                <div class="dw-crm-row"><span class="dw-crm-key">Téléphone</span><span class="dw-crm-val"><?php echo esc_html($active_phone_display); ?></span></div>
                <?php if ($has_name): ?>
                <div class="dw-crm-row"><span class="dw-crm-key">Nom</span><span class="dw-crm-val" style="font-family:inherit;"><?php echo esc_html($card['name']); ?></span></div>
                <?php endif; ?>
                <?php foreach (array('Email','Entreprise','Profession','Ville') as $pk): if (!empty($card['profile'][$pk])): ?>
                <div class="dw-crm-row"><span class="dw-crm-key"><?php echo esc_html($pk); ?></span><span class="dw-crm-val" style="font-family:inherit;"><?php echo esc_html($card['profile'][$pk]); ?></span></div>
                <?php endif; endforeach; ?>
                <?php if ($card['user_id']): ?>
                <a class="dw-crm-linkbtn" href="<?php echo esc_url($card['edit_url']); ?>">Modifier le profil client →</a>
                <?php else: ?>
                <div class="dw-crm-note">Aucune fiche client WordPress reliée à ce numéro — contact WhatsApp uniquement.</div>
                <?php endif; ?>
                <!-- 4. COMMERCIAL -->
                <div class="dw-crm-section-title">Commercial</div>
                <div class="dw-crm-row"><span class="dw-crm-key">État conversation</span><span class="dw-badge-status <?php echo $st_cls; ?>" style="font-family:inherit;"><?php echo esc_html($st_lbl); ?></span></div>
                <div class="dw-crm-row"><span class="dw-crm-key">Source</span><span class="dw-crm-pill dw-crm-pill-green">WhatsApp</span></div>
                <div class="dw-crm-row"><span class="dw-crm-key">Dernière activité</span><span class="dw-crm-val"><?php echo $c_last ? esc_html(self::fmt_time($c_last, 'd/m/Y H:i')) : '—'; ?></span></div>
                <?php
                    $cs_key = $card['crm_status']; $cs = isset($sd[$cs_key]) ? $sd[$cs_key] : array(ucfirst($cs_key), 'dw-st-prospect');
                ?>
                <div class="dw-crm-row" style="border-bottom:none;">
                    <span class="dw-crm-key">Statut commercial</span>
                    <span class="dw-badge-status <?php echo esc_attr($cs[1]); ?>" style="font-family:inherit;"><?php echo esc_html($cs[0]); ?></span>
                </div>
                <?php if ($card['crm_status_src'] === 'persisted'): ?>
                <div class="dw-crm-note">Statut enregistré dans le CRM (table digiware_whatsapp_contacts). <a href="<?php echo $fiche_url; ?>">Gérer dans CRM →</a></div>
                <?php else: ?>
                <div class="dw-crm-note">Statut déduit objectivement (commande payée / opt-out) et non encore qualifié manuellement. <a href="<?php echo $fiche_url; ?>">Qualifier dans CRM →</a></div>
                <?php endif; ?>
                <!-- 5. TAGS -->
                <div class="dw-crm-section-title">Tags &amp; segments</div>
                <?php if (!empty($card['crm_tags']) || !empty($card['crm_segments'])): ?>
                    <div class="dw-crm-tagwrap">
                        <?php foreach ($card['crm_tags'] as $tg): ?><span class="dw-crm-pill dw-crm-pill-green"><?php echo esc_html($tg); ?></span><?php endforeach; ?>
                        <?php foreach ($card['crm_segments'] as $sg): ?><span class="dw-crm-pill"><?php echo esc_html($sg); ?></span><?php endforeach; ?>
                    </div>
                    <div class="dw-crm-note">Tags &amp; segments enregistrés dans le CRM. <a href="<?php echo $fiche_url; ?>">Modifier →</a></div>
                <?php else: ?>
                    <div class="dw-crm-empty">Aucun tag ni segment enregistré.</div>
                    <div class="dw-crm-note"><a href="<?php echo $fiche_url; ?>">Ajouter des tags dans CRM →</a></div>
                <?php endif; ?>
                <!-- 6. PRODUITS & INTÉRÊTS -->
                <div class="dw-crm-section-title">Produits &amp; intérêts</div>
                <?php if (!$card['has_wc']): ?>
                    <div class="dw-crm-empty">WooCommerce indisponible.</div>
                <?php elseif (empty($card['products'])): ?>
                    <div class="dw-crm-empty">Aucun produit associé.</div>
                <?php else: foreach ($card['products'] as $pn => $qty): ?>
                    <div class="dw-crm-prod"><span class="dw-crm-prod-name"><?php echo esc_html($pn); ?></span><span class="dw-crm-prod-qty"><?php echo (int) $qty; ?>×</span></div>
                <?php endforeach; ?>
                    <div class="dw-crm-note">Produits réellement commandés par ce contact (WooCommerce).</div>
                <?php endif; ?>
                <!-- 7. COMMANDES -->
                <div class="dw-crm-section-title">Commandes<?php echo $card['orders_total'] > 0 ? ' · ' . (int) $card['orders_total'] : ''; ?></div>
                <?php if (!$card['has_wc']): ?>
                    <div class="dw-crm-empty">WooCommerce indisponible.</div>
                <?php elseif (empty($card['orders'])): ?>
                    <div class="dw-crm-empty">Aucune commande associée.</div>
                <?php else: foreach ($card['orders'] as $o): ?>
                    <a class="dw-crm-order" href="<?php echo esc_url($o['url']); ?>" title="Ouvrir la commande">
                        <div class="dw-crm-order-top">
                            <span class="dw-crm-order-num">#<?php echo esc_html($o['number']); ?></span>
                            <span class="dw-badge-status <?php echo self::conv_order_badge($o['status']); ?>" style="font-family:inherit;"><?php echo esc_html(wc_get_order_status_name($o['status'])); ?></span>
                        </div>
                        <div class="dw-crm-order-sub"><?php echo esc_html($o['product']); ?><?php echo $o['items'] > 1 ? ' +' . ($o['items'] - 1) : ''; ?> · <?php echo esc_html(number_format($o['total'], 3, ',', ' ') . ' ' . $o['currency']); ?></div>
                    </a>
                <?php endforeach; ?>
                    <div class="dw-crm-row" style="border-bottom:none;"><span class="dw-crm-key">Total payé</span><span class="dw-crm-val"><?php echo esc_html(number_format($card['orders_sum'], 3, ',', ' ') . ' ' . $card['currency']); ?></span></div>
                    <div class="dw-crm-note">Commandes reliées par le téléphone de facturation (WooCommerce, source unique).</div>
                <?php endif; ?>
                <!-- 8. ACTIVITÉ -->
                <div class="dw-crm-section-title">Activité récente</div>
                <div class="dw-crm-act-stats"><?php echo (int) $c_total; ?> message(s) · <?php echo (int) $c_replies; ?> réponse(s)<?php echo $card['orders_total'] > 0 ? ' · ' . (int) $card['orders_total'] . ' commande(s)' : ''; ?></div>
                <?php if (empty($card['activity'])): ?>
                    <div class="dw-crm-empty">Aucune activité.</div>
                <?php else: foreach ($card['activity'] as $a): ?>
                    <div class="dw-crm-act"><span class="dw-crm-act-ic"><?php echo $a['icon']; ?></span><span class="dw-crm-act-tx"><?php echo esc_html($a['text']); ?></span><span class="dw-crm-act-wh"><?php echo esc_html($fmt_ts($a['ts'])); ?></span></div>
                <?php endforeach; ?>
                    <a class="dw-crm-linkbtn" href="<?php echo $jrn_url; ?>">Voir le journal complet →</a>
                <?php endif; ?>
                <!-- 9. NOTES -->
                <div class="dw-crm-section-title">Notes internes</div>
                <?php if (trim($card['crm_notes']) !== ''): ?>
                    <div class="dw-crm-notebox"><?php echo nl2br(esc_html($card['crm_notes'])); ?></div>
                    <div class="dw-crm-note">Note enregistrée dans le CRM. <a href="<?php echo $fiche_url; ?>">Modifier →</a></div>
                <?php else: ?>
                    <div class="dw-crm-empty">Aucune note interne.</div>
                    <div class="dw-crm-note"><a href="<?php echo $fiche_url; ?>">Ajouter une note dans CRM →</a></div>
                <?php endif; ?>
                <?php else: ?>
                <div class="dw-crm-empty" style="text-align:center;padding-top:40px;">Sélectionnez une conversation pour afficher la fiche contact.</div>
                <?php endif; ?>
            </div>
        </div>

        <script>
        (function(){
            var LS_FAV='dwwa_fav', LS_ARCH='dwwa_arch';
            function load(k){ try{ return JSON.parse(localStorage.getItem(k)||'[]'); }catch(e){ return []; } }
            function save(k,a){ try{ localStorage.setItem(k, JSON.stringify(a)); }catch(e){} }
            function has(a,p){ return a.indexOf(p)!==-1; }
            function toggle(k,p){ var a=load(k), i=a.indexOf(p); if(i===-1){a.push(p);}else{a.splice(i,1);} save(k,a); return a.indexOf(p)!==-1; }

            var search = document.getElementById('dw-conv-search-input');
            var tabs   = [].slice.call(document.querySelectorAll('.dw-conv-tab'));
            var empty  = document.getElementById('dw-conv-empty');
            var filter = 'all';
            function apply(){
                var items = [].slice.call(document.querySelectorAll('.dw-conv-item'));
                var fav=load(LS_FAV), arch=load(LS_ARCH);
                var q=(search&&search.value||'').toLowerCase().trim();
                var shown=0;
                items.forEach(function(it){
                    var p=it.getAttribute('data-phone')||'';
                    var isArch=has(arch,p), isFav=has(fav,p), isUnread=it.getAttribute('data-unread')==='1';
                    var okQ=!q||(it.getAttribute('data-search')||'').indexOf(q)!==-1;
                    var okF = filter==='all'? !isArch
                            : filter==='unread'? (isUnread && !isArch)
                            : filter==='important'? isFav
                            : filter==='archived'? isArch : true;
                    var ok=okQ&&okF;
                    it.style.display=ok?'':'none';
                    if(ok)shown++;
                });
                if(empty)empty.style.display=shown===0?'':'none';
            }
            window.dwConvApply = apply;
            if(search)search.addEventListener('input',apply);
            tabs.forEach(function(t){ t.addEventListener('click',function(){ tabs.forEach(function(x){x.classList.remove('active');}); t.classList.add('active'); filter=t.getAttribute('data-filter'); apply(); }); });
            var fbtn=document.getElementById('dw-conv-filterbtn');
            if(fbtn)fbtn.addEventListener('click',function(){ var u=document.querySelector('.dw-conv-tab[data-filter="unread"]'); if(u)u.click(); });

            var head=document.getElementById('dw-head-actions');
            var active = head? head.getAttribute('data-phone') : '';
            var favBtn=document.getElementById('dw-btn-fav'), archBtn=document.getElementById('dw-btn-arch');
            if(favBtn&&active){ if(has(load(LS_FAV),active))favBtn.classList.add('on'); favBtn.addEventListener('click',function(){ favBtn.classList.toggle('on', toggle(LS_FAV,active)); apply(); }); }
            if(archBtn&&active){ archBtn.addEventListener('click',function(){ archBtn.classList.toggle('on', toggle(LS_ARCH,active)); apply(); }); }
            apply();
            var msg=document.getElementById('dw-msg-input');
            function insertTxt(t){ if(!msg)return; var s=msg.selectionStart, e=msg.selectionEnd; if(s==null){s=e=msg.value.length;} msg.value=msg.value.slice(0,s)+t+msg.value.slice(e); msg.focus(); var pos=s+t.length; try{msg.setSelectionRange(pos,pos);}catch(_){} }
            var emojiBtn=document.getElementById('dw-emoji-btn'), emojiPop=document.getElementById('dw-emoji-pop'), grid=document.getElementById('dw-emoji-grid');
            var EMO=['😀','😊','😉','😍','👍','🙏','🙌','👏','💪','🔥','✅','❌','⭐','🎉','💯','📌','📎','📞','📧','💼','🖥️','🛒','💰','🏷️','⏰','📅','➡️','❤️','🤝','👋'];
            if(grid){ EMO.forEach(function(x){ var b=document.createElement('button'); b.type='button'; b.textContent=x; b.addEventListener('click',function(){ insertTxt(x); }); grid.appendChild(b); }); }
            var tplBtn=document.getElementById('dw-tpl-btn'), tplPop=document.getElementById('dw-tpl-pop');
            var TPL=[{t:'Salutation',m:'Bonjour, merci pour votre message. Comment puis-je vous aider ?'},{t:'Offre licences',m:'Nous proposons des licences officielles (Windows, Office, antivirus). Souhaitez-vous un devis ?'},{t:'Devis',m:'Je vous prépare un devis personnalisé. Pouvez-vous préciser vos besoins ?'},{t:'Relance',m:'Bonjour, je reviens vers vous concernant notre proposition. Avez-vous pu la consulter ?'},{t:'Remerciement',m:'Merci pour votre confiance ! N’hésitez pas si vous avez la moindre question.'},{t:'Clôture',m:'Ravi d’avoir pu vous aider. Belle journée de la part de l’équipe DigiWare Tunisie.'}];
            if(tplPop){ TPL.forEach(function(x){ var b=document.createElement('button'); b.type='button'; b.className='dw-tpl-item'; var s=document.createElement('strong'); s.textContent=x.t; b.appendChild(s); b.appendChild(document.createTextNode(x.m)); b.addEventListener('click',function(){ if(msg){msg.value=x.m; msg.focus();} tplPop.classList.remove('open'); }); tplPop.appendChild(b); }); }
            if(emojiBtn&&emojiPop)emojiBtn.addEventListener('click',function(e){ e.stopPropagation(); emojiPop.classList.toggle('open'); if(tplPop)tplPop.classList.remove('open'); });
            if(tplBtn&&tplPop)tplBtn.addEventListener('click',function(e){ e.stopPropagation(); tplPop.classList.toggle('open'); if(emojiPop)emojiPop.classList.remove('open'); });
            document.addEventListener('click',function(){ if(emojiPop)emojiPop.classList.remove('open'); if(tplPop)tplPop.classList.remove('open'); });

            var fileInput=document.getElementById('dw-file-input'), chip=document.getElementById('dw-attach-chip'), chipName=document.getElementById('dw-attach-name'), chipClear=document.getElementById('dw-attach-clear');
            [].slice.call(document.querySelectorAll('.dw-media-btn')).forEach(function(b){ b.addEventListener('click',function(){ if(!fileInput)return; fileInput.setAttribute('accept', b.getAttribute('data-accept')||'*/*'); fileInput.click(); }); });
            if(fileInput)fileInput.addEventListener('change',function(){ if(fileInput.files&&fileInput.files[0]&&chip){ chipName.textContent=fileInput.files[0].name+' — l’envoi de fichiers arrive bientôt'; chip.classList.add('show'); } });
            if(chipClear)chipClear.addEventListener('click',function(){ if(fileInput)fileInput.value=''; if(chip)chip.classList.remove('show'); });
        })();
        </script>

        <script>
        /* Conversation temps réel — rafraîchissement en arrière-plan, sans rechargement (comme WhatsApp Web) */
        (function(){
            var AJAX  = (window.ajaxurl || '/wp-admin/admin-ajax.php');
            var NONCE = '<?php echo esc_js(wp_create_nonce('dw_conv_ajax')); ?>';
            var LIST_BASE = '<?php echo esc_js(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'conversations'), admin_url('admin.php'))); ?>';
            var head   = document.getElementById('dw-head-actions');
            var ACTIVE = head ? (head.getAttribute('data-phone')||'') : '';
            var box    = document.querySelector('.dw-chat-messages');
            var form   = document.getElementById('dw-conv-form');
            var input  = document.getElementById('dw-msg-input');
            var listWrap = document.querySelector('.dw-chat-list');
            var lastSig = '__init__';
            var sending = false;

            function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
            function nl2br(s){ return esc(s).replace(/\n/g,'<br/>'); }
            var TICK_READ='<span class="dw-tick" title="Lu" style="color:#34b7f1;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7 8.5 16.5 5 13"/><path d="M22 7 12.5 16.5"/></svg></span>';
            var TICK_DELIV='<span class="dw-tick" title="Livré" style="color:#94a3b8;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7 8.5 16.5 5 13"/><path d="M22 7 12.5 16.5"/></svg></span>';
            var TICK_SENT='<span class="dw-tick" title="Envoyé" style="color:#94a3b8;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7 9 18l-5-5"/></svg></span>';
            function tick(st){ if(st==='read')return TICK_READ; if(st==='delivered')return TICK_DELIV; return TICK_SENT; }
            function nearBottom(){ if(!box)return true; return (box.scrollHeight - box.scrollTop - box.clientHeight) < 80; }

            /* DW_POLLER_PLACEHOLDER */
            function renderThread(thread){
                if(!box) return;
                var last = thread.length ? thread[thread.length-1] : null;
                var sig = thread.length + '|' + (last ? (last.st+'|'+last.h+'|'+last.body) : '');
                if(sig===lastSig) return;              /* rien de neuf : aucun re-rendu, zéro clignotement */
                var stick = nearBottom();
                var html='', lastDate='';
                for(var i=0;i<thread.length;i++){
                    var m=thread[i], out=(m.dir==='out');
                    if(m.d!==lastDate){ lastDate=m.d; html+='<div class="dw-date-sep">'+esc(m.d)+'</div>'; }
                    html+='<div class="dw-msg-bubble '+(out?'dw-msg-outbound':'dw-msg-inbound')+'" data-at="'+esc(m.at||'')+'" data-dir="'+esc(m.dir||'')+'" data-st="'+esc(m.st||'')+'" data-created="'+esc(m.created||'')+'" data-sent="'+esc(m.sent||'')+'">';
                    html+='<div>'+nl2br(m.body)+'</div>';
                    html+='<div class="dw-msg-meta" style="color:'+(out?'#059669':'#94a3b8')+';"><span>'+esc(m.h)+'</span>';
                    if(out) html+=tick(m.st);
                    html+='</div></div>';
                }
                if(!thread.length) html='<div style="color:#64748b;font-size:13px;padding:20px;">Sélectionnez une conversation à gauche.</div>';
                box.innerHTML=html;
                lastSig=sig;
                if(stick) box.scrollTop=box.scrollHeight;
            }

            function upsertList(list){
                if(!listWrap) return;
                var sample = listWrap.querySelector('.dw-conv-item');
                var parent = sample ? sample.parentNode : listWrap;
                var byPhone = {};
                [].slice.call(listWrap.querySelectorAll('.dw-conv-item')).forEach(function(it){ byPhone[it.getAttribute('data-phone')]=it; });
                list.forEach(function(row){
                    var it = byPhone[row.digits];
                    if(!it){
                        it=document.createElement('a');
                        it.className='dw-conv-item';
                        it.href=LIST_BASE+'&thread='+encodeURIComponent(row.digits);
                        it.setAttribute('data-phone', row.digits);
                        it.innerHTML='<div class="dw-conv-ava"></div><div class="dw-conv-body"><div class="dw-conv-top"><span class="dw-conv-name"></span><span class="dw-conv-time"></span></div><div class="dw-conv-snippet"></div></div>';
                        if(parent) parent.appendChild(it);
                    }
                    it.setAttribute('data-unread', row.in_count>0?'1':'0');
                    it.setAttribute('data-search', (row.digits+' '+row.phone+' '+row.snippet).toLowerCase());
                    var ava=it.querySelector('.dw-conv-ava'); if(ava) ava.textContent=(row.digits||'').slice(-2);
                    var nm=it.querySelector('.dw-conv-name'); if(nm) nm.textContent=row.phone;
                    var tm=it.querySelector('.dw-conv-time'); if(tm) tm.textContent=row.time;
                    var sn=it.querySelector('.dw-conv-snippet'); if(sn) sn.textContent=row.snippet;
                    var badge=it.querySelector('.dw-conv-badge');
                    if(row.in_count>0){ if(!badge){ badge=document.createElement('span'); badge.className='dw-conv-badge'; it.appendChild(badge);} badge.textContent=row.in_count; }
                    else if(badge){ badge.parentNode.removeChild(badge); }
                    it._ts = row.ts;
                });
                if(parent){
                    var arr=[].slice.call(parent.querySelectorAll('.dw-conv-item'));
                    arr.sort(function(a,b){ return (b._ts||0)-(a._ts||0); });
                    arr.forEach(function(el){ parent.appendChild(el); });
                }
                if(window.dwConvApply) window.dwConvApply();
            }

            function updateKpis(c){
                var nums=document.querySelectorAll('.dw-kpi-num');
                if(nums[0]) nums[0].textContent=c.convos;
                if(nums[1]) nums[1].textContent=c.replies;
                if(nums[2]) nums[2].textContent=c.sent;
                if(nums[3]) nums[3].textContent=c.pending;
                if(nums[4]) nums[4].textContent=(c.convos>0?Math.round(c.unread/c.convos*100):0)+'%';
            }

            function poll(){
                var url=AJAX+'?action=dw_conv_poll&nonce='+encodeURIComponent(NONCE)+(ACTIVE?('&phone='+encodeURIComponent(ACTIVE)):'');
                fetch(url,{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){
                    if(!j||!j.success||!j.data) return;
                    if(ACTIVE) renderThread(j.data.thread||[]);
                    upsertList(j.data.list||[]);
                    updateKpis(j.data.counts||{});
                }).catch(function(){});
            }

            function optimistic(txt){
                if(!box) return;
                var n=new Date(), hh=('0'+n.getHours()).slice(-2)+':'+('0'+n.getMinutes()).slice(-2);
                var b=document.createElement('div'); b.className='dw-msg-bubble dw-msg-outbound';
                b.innerHTML='<div>'+nl2br(txt)+'</div><div class="dw-msg-meta" style="color:#059669;"><span>'+hh+'</span>'+TICK_SENT+'</div>';
                box.appendChild(b); box.scrollTop=box.scrollHeight;
                lastSig='__optim__';   /* force le prochain rendu serveur */
            }

            if(form){
                form.addEventListener('submit',function(e){
                    e.preventDefault();
                    if(sending) return;
                    var txt=(input&&input.value||'').trim();
                    var phone=form.getAttribute('data-phone')||ACTIVE;
                    if(!txt||!phone) return;
                    sending=true;
                    optimistic(txt);
                    if(input){ input.value=''; input.style.height=''; }
                    var body='action=dw_conv_send&nonce='+encodeURIComponent(NONCE)+'&phone='+encodeURIComponent(phone)+'&message='+encodeURIComponent(txt);
                    fetch(AJAX,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body})
                        .then(function(r){return r.json();}).then(function(){ sending=false; poll(); })
                        .catch(function(){ sending=false; });
                });
            }
            if(input){
                input.addEventListener('keydown',function(e){
                    if(e.key==='Enter' && !e.shiftKey){
                        e.preventDefault();
                        if(form){ if(form.requestSubmit){ form.requestSubmit(); } else { form.dispatchEvent(new Event('submit',{cancelable:true})); } }
                    }
                });
            }

            /* Bouton : actualiser ce chat maintenant (sans recharger la page) */
            var rbtn=document.getElementById('dw-btn-refresh');
            if(rbtn){ rbtn.addEventListener('click',function(){ if(rbtn.animate){ rbtn.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:500,easing:'ease-in-out'}); } lastSig='__force__'; poll(); }); }

            /* Bouton : copier la conversation (avec horodatage complet, pour diagnostic) */
            function flash(btn,msg){
                var t=document.createElement('div'); t.textContent=msg;
                t.style.cssText='position:fixed;z-index:99999;background:#0f172a;color:#fff;padding:6px 12px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.25);';
                var r=btn.getBoundingClientRect(); t.style.top=(r.bottom+8)+'px'; t.style.left=Math.max(8,r.left-30)+'px';
                document.body.appendChild(t);
                setTimeout(function(){ t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(function(){ if(t.parentNode)t.parentNode.removeChild(t); },300); },1000);
            }
            function buildTranscript(){
                var name=(document.querySelector('.dw-chat-head-name')||{}).textContent||ACTIVE;
                var lines=['Conversation : '+(name||'').trim(),''];
                var nodes=box?box.children:[]; var curDate='';
                for(var i=0;i<nodes.length;i++){
                    var el=nodes[i];
                    if(el.classList && el.classList.contains('dw-date-sep')){ curDate=(el.textContent||'').trim(); lines.push(''); lines.push('=== '+curDate+' ==='); continue; }
                    if(!el.classList || !el.classList.contains('dw-msg-bubble')) continue;
                    var out=el.classList.contains('dw-msg-outbound');
                    var at=el.getAttribute('data-at')||''; var created=el.getAttribute('data-created')||''; var sent=el.getAttribute('data-sent')||''; var st=el.getAttribute('data-st')||'';
                    var timeEl=el.querySelector('.dw-msg-meta span'); var hh=timeEl?(timeEl.textContent||'').trim():'';
                    var bodyEl=el.querySelector('div'); var body=bodyEl?(bodyEl.innerText||bodyEl.textContent||'').trim():'';
                    var dir=out?'-> MOI   ':'<- CLIENT';
                    var meta=at?('affiché='+at):((curDate?curDate+' ':'')+hh);
                    if(out){ meta+=' | créé='+(created||'?')+' | envoyé='+(sent||'?')+(st?(' | '+st):''); }
                    lines.push('['+meta+'] '+dir+' : '+body);
                }
                return lines.join('\n');
            }
            function copyText(t){
                if(navigator.clipboard && navigator.clipboard.writeText){ return navigator.clipboard.writeText(t); }
                return new Promise(function(res,rej){ var ta=document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.focus(); ta.select(); var ok=false; try{ok=document.execCommand('copy');}catch(e){} document.body.removeChild(ta); ok?res():rej(); });
            }
            var cbtn=document.getElementById('dw-btn-copy');
            if(cbtn){ cbtn.addEventListener('click',function(){ var txt=buildTranscript(); copyText(txt).then(function(){ flash(cbtn,'Conversation copiée'); }).catch(function(){ window.prompt('Copiez la conversation (Ctrl+C) :', txt); }); }); }

            var timer=setInterval(function(){ if(!document.hidden) poll(); }, 3000);
            document.addEventListener('visibilitychange',function(){ if(!document.hidden) poll(); });
            poll();
        })();
        </script>
        <?php
    }

    private static function render_crm_tab() {
        $contact = isset($_GET['contact']) ? sanitize_text_field(wp_unslash($_GET['contact'])) : '';
        if ($contact !== '') { self::render_crm_fiche($contact); return; }
        self::render_crm_list();
    }

    // __CRM_LIST_FICHE__
    private static function render_crm_list() {
        $contacts = self::crm_collect_contacts();
        $sd = self::crm_status_defs();
        $now = time();
        $k_total = count($contacts); $k_clients = 0; $k_prospects = 0; $k_relance = 0; $k_new = 0; $k_answered = 0;
        foreach ($contacts as $c) {
            $is_client = ($c['status'] === 'client' || $c['orders_paid'] > 0);
            if ($is_client)                     { $k_clients++; }
            elseif ($c['status'] === 'a_relancer') { $k_relance++; }
            elseif ($c['status'] !== 'optout')  { $k_prospects++; }
            if ($c['in_count'] > 0)             { $k_answered++; }
            $ref = $c['last_seen'] ? strtotime($c['last_seen'] . ' UTC') : ($c['created'] ? strtotime($c['created'] . ' UTC') : 0);
            if ($ref > 0 && ($now - $ref) <= 7 * DAY_IN_SECONDS) { $k_new++; }
        }
        $all_tags     = self::crm_tag_catalog();
        $all_segments = self::crm_segment_catalog();
        $nonce        = wp_create_nonce('dw_wa_action_nonce');
        $add_url = esc_url(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm','contact'=>'new'), admin_url('admin.php')));
        $saved   = isset($_GET['crm']) ? sanitize_key($_GET['crm']) : '';
        ?>
        <div class="dw-card">
            <div class="dw-crm-listhead">
                <div>
                    <h2 style="margin:0;font-size:18px;font-weight:800;">Contacts</h2>
                    <p class="dw-section-intro" style="margin:4px 0 0;">Identité centrale = Lead ID. Chaque contact vient d'un échange WhatsApp réel ; statut, tags, segments et notes sont persistés dans le CRM et partagés avec la colonne CRM de Conversations.</p>
                </div>
                <a href="<?php echo $add_url; ?>" class="dw-mini-btn primary" title="Créer une fiche contact (enregistrée en base)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Ajouter un contact</span></a>
            </div>
            <?php if ($saved === 'saved'): ?><div class="dw-crm-flash">✓ Fiche contact enregistrée.</div><?php endif; ?>
            <?php if ($saved === 'deleted'): ?><div class="dw-crm-flash">✓ Fiche contact supprimée.</div><?php endif; ?>
            <?php if ($saved === 'tag_created'): ?><div class="dw-crm-flash">✓ Tag créé (catalogue).</div><?php endif; ?>
            <?php if ($saved === 'segment_created'): ?><div class="dw-crm-flash">✓ Segment créé (catalogue).</div><?php endif; ?>
            <?php if ($saved === 'bulk'): ?><div class="dw-crm-flash">✓ Action groupée appliquée à <?php echo isset($_GET['n']) ? (int) $_GET['n'] : 0; ?> contact(s).</div><?php endif; ?>

            <div class="dw-stats-grid dw-crm-kpis">
                <div class="dw-stat-box"><div class="dw-stat-label">Total contacts</div><div class="dw-stat-num"><?php echo (int) $k_total; ?></div></div>
                <div class="dw-stat-box"><div class="dw-stat-label">Clients</div><div class="dw-stat-num" style="color:#059669;"><?php echo (int) $k_clients; ?></div></div>
                <div class="dw-stat-box"><div class="dw-stat-label">Prospects</div><div class="dw-stat-num" style="color:#2563eb;"><?php echo (int) $k_prospects; ?></div></div>
                <div class="dw-stat-box"><div class="dw-stat-label">À relancer</div><div class="dw-stat-num" style="color:#d97706;"><?php echo (int) $k_relance; ?></div></div>
                <div class="dw-stat-box"><div class="dw-stat-label">Nouveaux (7j)</div><div class="dw-stat-num"><?php echo (int) $k_new; ?></div></div>
            </div>
            <div class="dw-crm-toolbar">
                <div class="dw-crm-searchbox">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input type="text" id="dw-crm-search" placeholder="Rechercher : nom, téléphone, email, Lead ID..." autocomplete="off" />
                </div>
                <div class="dw-chip-row">
                    <button type="button" class="dw-conv-tab active" data-crmfilter="all">Tous (<?php echo (int) $k_total; ?>)</button>
                    <button type="button" class="dw-conv-tab" data-crmfilter="client">Clients (<?php echo (int) $k_clients; ?>)</button>
                    <button type="button" class="dw-conv-tab" data-crmfilter="prospect">Prospects (<?php echo (int) $k_prospects; ?>)</button>
                    <button type="button" class="dw-conv-tab" data-crmfilter="a_relancer">À relancer (<?php echo (int) $k_relance; ?>)</button>
                    <button type="button" class="dw-conv-tab" data-crmfilter="optout">Opt-out</button>
                    <button type="button" class="dw-conv-tab" data-crmfilter="answered">Ont répondu (<?php echo (int) $k_answered; ?>)</button>
                </div>
                <?php if (!empty($all_tags)): ?>
                <select id="dw-crm-tagfilter" class="dw-crm-select" style="max-width:170px;">
                    <option value="">Tous les tags</option>
                    <?php foreach ($all_tags as $tg): ?><option value="<?php echo esc_attr(strtolower($tg)); ?>"><?php echo esc_html($tg); ?></option><?php endforeach; ?>
                </select>
                <?php endif; ?>
                <?php if (!empty($all_segments)): ?>
                <select id="dw-crm-segfilter" class="dw-crm-select" style="max-width:170px;">
                    <option value="">Tous les segments</option>
                    <?php foreach ($all_segments as $sg): ?><option value="<?php echo esc_attr(strtolower($sg)); ?>"><?php echo esc_html($sg); ?></option><?php endforeach; ?>
                </select>
                <?php endif; ?>
            </div>

            <div class="dw-crm-manage">
                <form method="post" action="<?php echo esc_url(admin_url('admin.php')); ?>" class="dw-crm-createform">
                    <input type="hidden" name="dw_wa_action" value="crm_create_tag" />
                    <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                    <span class="dw-crm-managelbl">Tags</span>
                    <input type="text" name="label" maxlength="40" placeholder="Nouveau tag…" required />
                    <button type="submit" class="dw-crm-addbtn">+ Créer</button>
                </form>
                <form method="post" action="<?php echo esc_url(admin_url('admin.php')); ?>" class="dw-crm-createform">
                    <input type="hidden" name="dw_wa_action" value="crm_create_segment" />
                    <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                    <span class="dw-crm-managelbl">Segments</span>
                    <input type="text" name="label" maxlength="40" placeholder="Nouveau segment…" required />
                    <button type="submit" class="dw-crm-addbtn">+ Créer</button>
                </form>
            </div>

            <?php if (empty($contacts)): ?>
                <div class="dw-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <div>Aucun contact pour le moment. Les contacts apparaîtront dès le premier échange WhatsApp, ou créez-en un manuellement.</div>
                </div>
            <?php else: ?>
            <form method="post" action="<?php echo esc_url(admin_url('admin.php')); ?>" id="dw-crm-bulkform">
                <input type="hidden" name="dw_wa_action" value="crm_bulk_apply" />
                <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                <div class="dw-crm-bulkbar" id="dw-crm-bulkbar" aria-hidden="true">
                    <span class="dw-crm-bulkcount"><strong id="dw-crm-selcount">0</strong> sélectionné(s)</span>
                    <select name="bulk_kind" id="dw-crm-bulkkind" class="dw-crm-select">
                        <option value="tag">Tag</option>
                        <option value="segment">Segment</option>
                    </select>
                    <select name="bulk_op" class="dw-crm-select">
                        <option value="add">Ajouter</option>
                        <option value="remove">Retirer</option>
                    </select>
                    <select name="bulk_value" id="dw-crm-bulkvalue" class="dw-crm-select" required></select>
                    <button type="submit" class="dw-crm-addbtn" id="dw-crm-bulkapply">Appliquer</button>
                    <span class="dw-crm-bulkhint" id="dw-crm-bulkhint" style="display:none;">Créez d'abord un tag ou un segment ci-dessus.</span>
                </div>
            <div class="dw-table-wrap">
                <table class="dw-table" id="dw-crm-table">
                    <thead>
                        <tr>
                            <th class="dw-crm-cbcell"><input type="checkbox" id="dw-crm-selall" title="Tout sélectionner" /></th>
                            <th>Contact</th><th>Téléphone</th><th>Statut</th><th>Tags</th><th>Segments</th>
                            <th>Source</th><th>Dernière activité</th><th>Commandes</th><th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($contacts as $c):
                            $cs = isset($sd[$c['status']]) ? $sd[$c['status']] : array(ucfirst($c['status']), 'dw-st-prospect');
                            $is_client = ($c['status'] === 'client' || $c['orders_paid'] > 0);
                            $filter_key = $c['status'] === 'a_relancer' ? 'a_relancer' : ($c['status'] === 'optout' ? 'optout' : ($is_client ? 'client' : 'prospect'));
                            $ident = $c['name'] !== '' ? $c['name'] : $c['display'];
                            $ini   = $c['name'] !== '' ? strtoupper(mb_substr($c['name'], 0, 1)) : substr($c['norm'], -2);
                            $search = strtolower(trim($c['name'] . ' ' . $c['norm'] . ' ' . $c['email'] . ' ' . $c['contact_id'] . ' ' . $c['company']));
                            $tagattr = strtolower(implode(',', $c['tags']));
                            $segattr = strtolower(implode(',', $c['segments']));
                            $fiche_url = esc_url(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm','contact'=>$c['contact_id'],'phone'=>$c['norm']), admin_url('admin.php')));
                            $conv_url  = esc_url(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'conversations','thread'=>$c['norm']), admin_url('admin.php')));
                            $wa_url    = 'https://wa.me/' . rawurlencode($c['norm']);
                        ?>
                        <tr data-search="<?php echo esc_attr($search); ?>" data-crmstatus="<?php echo esc_attr($filter_key); ?>" data-answered="<?php echo $c['in_count'] > 0 ? '1' : '0'; ?>" data-tags="<?php echo esc_attr($tagattr); ?>" data-segments="<?php echo esc_attr($segattr); ?>">
                            <td class="dw-crm-cbcell"><input type="checkbox" class="dw-crm-rowcb" name="contacts[]" value="<?php echo esc_attr($c['norm']); ?>" /></td>
                            <td>
                                <a class="dw-cell-contact" href="<?php echo $fiche_url; ?>" style="text-decoration:none;color:inherit;">
                                    <span class="dw-mini-avatar"><?php echo esc_html($ini); ?></span>
                                    <span><strong><?php echo esc_html($ident); ?></strong><br><span style="font-size:11px;color:#94a3b8;font-family:monospace;"><?php echo esc_html($c['contact_id']); ?></span></span>
                                </a>
                            </td>
                            <td style="font-family:monospace;"><?php echo esc_html($c['display']); ?></td>
                            <td><span class="dw-badge-status <?php echo esc_attr($cs[1]); ?>"><?php echo esc_html($cs[0]); ?></span></td>
                            <td><?php if (!empty($c['tags'])) { foreach (array_slice($c['tags'], 0, 3) as $tg) { echo '<span class="dw-crm-pill dw-crm-pill-green">' . esc_html($tg) . '</span> '; } } else { echo '<span style="color:#cbd5e1;">—</span>'; } ?></td>
                            <td><?php if (!empty($c['segments'])) { foreach (array_slice($c['segments'], 0, 3) as $sg) { echo '<span class="dw-crm-pill dw-crm-pill-blue">' . esc_html($sg) . '</span> '; } } else { echo '<span style="color:#cbd5e1;">—</span>'; } ?></td>
                            <td><span class="dw-crm-pill dw-crm-pill-green">WhatsApp</span></td>
                            <td><?php echo $c['last_seen'] ? esc_html(self::fmt_time($c['last_seen'], 'j M Y H:i')) : '&mdash;'; ?></td>
                            <td><?php echo $c['orders_total'] > 0 ? '<strong>' . (int) $c['orders_paid'] . '</strong>/' . (int) $c['orders_total'] . ' <span style="font-size:11px;color:#94a3b8;">payées</span>' : '<span style="color:#cbd5e1;">—</span>'; ?></td>
                            <td>
                                <div class="dw-row-actions">
                                    <a href="<?php echo $fiche_url; ?>" class="dw-mini-btn primary" title="Ouvrir la fiche contact"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg><span>Fiche</span></a>
                                    <a href="<?php echo $conv_url; ?>" class="dw-mini-btn" title="Ouvrir la conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></a>
                                    <a href="<?php echo esc_url($wa_url); ?>" target="_blank" rel="noopener" class="dw-mini-btn" title="Ouvrir dans WhatsApp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>
                                </div>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
                <div class="dw-empty-state" id="dw-crm-empty" style="display:none;">Aucun contact ne correspond à ce filtre.</div>
            </div>
            </form>
            <script>
            (function(){
                var TAGS = <?php echo wp_json_encode(array_values($all_tags)); ?>;
                var SEGS = <?php echo wp_json_encode(array_values($all_segments)); ?>;
                var search = document.getElementById('dw-crm-search');
                var tagsel = document.getElementById('dw-crm-tagfilter');
                var segsel = document.getElementById('dw-crm-segfilter');
                var rows = [].slice.call(document.querySelectorAll('#dw-crm-table tbody tr'));
                var chips = [].slice.call(document.querySelectorAll('[data-crmfilter]'));
                var empty = document.getElementById('dw-crm-empty');
                var filter = 'all';
                function apply(){
                    var q = (search && search.value || '').toLowerCase().trim();
                    var tg = (tagsel && tagsel.value || '').toLowerCase().trim();
                    var sg = (segsel && segsel.value || '').toLowerCase().trim();
                    var shown = 0;
                    rows.forEach(function(tr){
                        var okQ = !q || (tr.getAttribute('data-search')||'').indexOf(q) !== -1;
                        var st = tr.getAttribute('data-crmstatus');
                        var okF = filter === 'all' ? true : (filter === 'answered' ? tr.getAttribute('data-answered') === '1' : st === filter);
                        var okT = !tg || (','+(tr.getAttribute('data-tags')||'')+',').indexOf(','+tg+',') !== -1;
                        var okS = !sg || (','+(tr.getAttribute('data-segments')||'')+',').indexOf(','+sg+',') !== -1;
                        var ok = okQ && okF && okT && okS;
                        tr.style.display = ok ? '' : 'none';
                        if (ok) shown++;
                    });
                    if (empty) empty.style.display = shown === 0 ? '' : 'none';
                    syncSelAll();
                }
                if (search) search.addEventListener('input', apply);
                if (tagsel) tagsel.addEventListener('change', apply);
                if (segsel) segsel.addEventListener('change', apply);
                chips.forEach(function(c){ c.addEventListener('click', function(){ chips.forEach(function(x){x.classList.remove('active');}); c.classList.add('active'); filter = c.getAttribute('data-crmfilter'); apply(); }); });

                // Sélection multiple + action groupée
                var selall = document.getElementById('dw-crm-selall');
                var bar    = document.getElementById('dw-crm-bulkbar');
                var count  = document.getElementById('dw-crm-selcount');
                var kind   = document.getElementById('dw-crm-bulkkind');
                var valsel = document.getElementById('dw-crm-bulkvalue');
                var hint   = document.getElementById('dw-crm-bulkhint');
                var applyBtn = document.getElementById('dw-crm-bulkapply');
                function visibleCbs(){ return rows.filter(function(tr){ return tr.style.display !== 'none'; }).map(function(tr){ return tr.querySelector('.dw-crm-rowcb'); }).filter(Boolean); }
                function selectedCbs(){ return [].slice.call(document.querySelectorAll('.dw-crm-rowcb')).filter(function(cb){ return cb.checked; }); }
                function refreshBar(){
                    var n = selectedCbs().length;
                    if (count) count.textContent = n;
                    if (bar) { bar.classList.toggle('show', n > 0); bar.setAttribute('aria-hidden', n > 0 ? 'false' : 'true'); }
                }
                function syncSelAll(){
                    if (!selall) return;
                    var vis = visibleCbs();
                    var checked = vis.filter(function(cb){ return cb.checked; }).length;
                    selall.checked = vis.length > 0 && checked === vis.length;
                    selall.indeterminate = checked > 0 && checked < vis.length;
                }
                function fillValues(){
                    if (!valsel) return;
                    var list = (kind && kind.value === 'segment') ? SEGS : TAGS;
                    valsel.innerHTML = '';
                    list.forEach(function(v){ var o = document.createElement('option'); o.value = v; o.textContent = v; valsel.appendChild(o); });
                    var none = list.length === 0;
                    if (hint) hint.style.display = none ? '' : 'none';
                    valsel.style.display = none ? 'none' : '';
                    if (applyBtn) applyBtn.disabled = none;
                }
                if (selall) selall.addEventListener('change', function(){ visibleCbs().forEach(function(cb){ cb.checked = selall.checked; }); refreshBar(); });
                [].slice.call(document.querySelectorAll('.dw-crm-rowcb')).forEach(function(cb){ cb.addEventListener('change', function(){ refreshBar(); syncSelAll(); }); });
                if (kind) kind.addEventListener('change', fillValues);
                fillValues(); refreshBar();
            })();
            </script>
            <?php endif; ?>
        </div>
        <?php
    }

    // __CRM_FICHE__
    private static function render_crm_fiche($contact_id) {
        $is_new = ($contact_id === 'new' || $contact_id === '');
        $rec = $is_new ? null : self::crm_get_record($contact_id);
        $phone_param = isset($_GET['phone']) ? preg_replace('/[^0-9]/', '', wp_unslash($_GET['phone'])) : '';
        $norm = $rec ? self::crm_norm_phone($rec['phone']) : self::crm_norm_phone($phone_param);
        $sd = self::crm_status_defs();
        $back_url = esc_url(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'crm'), admin_url('admin.php')));

        // Enrichissement réel (utilisateur WP + WooCommerce + activité messagerie).
        $wp = $norm !== '' ? self::crm_wp_enrich($norm) : array('user_id'=>0,'name'=>'','email'=>'','company'=>'','city'=>'','profession'=>'');
        $wc = self::crm_wc_index();
        $o  = ($norm !== '' && isset($wc[$norm])) ? $wc[$norm] : null;
        $thread = $norm !== '' ? self::crm_phone_thread($norm, 8) : array();

        $wp_first = ''; $wp_last = '';
        if ($wp['name'] !== '') { $parts = explode(' ', $wp['name'], 2); $wp_first = $parts[0]; $wp_last = isset($parts[1]) ? $parts[1] : ''; }
        $eff = array(
            'first_name' => $rec ? $rec['first_name'] : $wp_first,
            'last_name'  => $rec ? $rec['last_name']  : $wp_last,
            'civility'   => $rec ? $rec['civility']   : '',
            'phone'      => $rec ? $rec['phone'] : $norm,
            'email'      => ($rec && $rec['email'])      ? $rec['email']      : $wp['email'],
            'company'    => ($rec && $rec['company'])    ? $rec['company']    : $wp['company'],
            'profession' => ($rec && $rec['profession']) ? $rec['profession'] : $wp['profession'],
            'job_title'  => $rec ? $rec['job_title'] : '',
            'city'       => ($rec && $rec['city'])       ? $rec['city']       : $wp['city'],
            'address'    => $rec ? $rec['address'] : '',
            'sector'     => $rec ? $rec['sector'] : '',
            'notes'      => $rec ? $rec['notes'] : '',
            'tags'       => $rec ? implode(', ', $rec['tags']) : '',
            'segments'   => $rec ? implode(', ', $rec['segments']) : '',
            'status'     => ($rec && $rec['commercial_status']) ? $rec['commercial_status'] : (($o && $o['paid'] > 0) ? 'client' : 'prospect'),
        );
        $display_name = trim($eff['first_name'] . ' ' . $eff['last_name']);
        if ($display_name === '') { $display_name = $norm !== '' ? '+' . $norm : 'Nouveau contact'; }
        $ini = $display_name !== '' && !ctype_digit($display_name[0]) ? strtoupper(mb_substr($display_name, 0, 1)) : ($norm !== '' ? substr($norm, -2) : '+');
        $cs = isset($sd[$eff['status']]) ? $sd[$eff['status']] : array(ucfirst($eff['status']), 'dw-st-prospect');
        $save_cid = $rec ? $rec['contact_id'] : ($norm !== '' ? 'ct_' . substr(md5($norm), 0, 8) : '');
        $conv_url = $norm !== '' ? esc_url(add_query_arg(array('page'=>'digiware-whatsapp','tab'=>'conversations','thread'=>$norm), admin_url('admin.php'))) : '';
        $wa_url   = $norm !== '' ? 'https://wa.me/' . rawurlencode($norm) : '';
        $tz = self::dash_tz_offset();
        // __CRM_FICHE_BODY__
        ?>
        <div class="dw-card">
            <div class="dw-crm-fiche-top">
                <a href="<?php echo $back_url; ?>" class="dw-crm-back">← Contacts</a>
                <div class="dw-crm-fiche-actions">
                    <?php if ($conv_url): ?><a href="<?php echo $conv_url; ?>" class="dw-mini-btn primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Conversation</span></a><?php endif; ?>
                    <?php if ($wa_url): ?><a href="<?php echo esc_url($wa_url); ?>" target="_blank" rel="noopener" class="dw-mini-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>Appeler</span></a><?php endif; ?>
                    <?php if ($wp['user_id']): ?><a href="<?php echo esc_url(get_edit_user_link($wp['user_id'])); ?>" class="dw-mini-btn"><span>Profil WP</span></a><?php endif; ?>
                </div>
            </div>
            <div class="dw-crm-fiche-head">
                <div class="dw-crm-avatar"><?php echo esc_html($ini); ?></div>
                <div>
                    <div class="dw-crm-name" style="font-size:18px;"><?php echo esc_html($display_name); ?></div>
                    <div class="dw-crm-phone-sub"><?php echo $norm !== '' ? esc_html('+' . $norm) : 'Téléphone à renseigner'; ?> · <span style="font-family:monospace;"><?php echo esc_html($save_cid !== '' ? $save_cid : 'Lead ID à créer'); ?></span></div>
                </div>
                <span class="dw-badge-status <?php echo esc_attr($cs[1]); ?>" style="margin-left:auto;"><?php echo esc_html($cs[0]); ?></span>
            </div>

            <div class="dw-crm-fiche-grid">
                <div class="dw-crm-fiche-col">
                    <form method="post" action="<?php echo esc_url(admin_url('admin.php')); ?>" class="dw-crm-form">
                        <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                        <input type="hidden" name="dw_wa_action" value="crm_save_contact" />
                        <input type="hidden" name="contact_id" value="<?php echo esc_attr($save_cid); ?>" />

                        <div class="dw-crm-section-title">1. Identité</div>
                        <div class="dw-crm-form-grid">
                            <label>Civilité<input type="text" name="civility" value="<?php echo esc_attr($eff['civility']); ?>" placeholder="M., Mme, Dr..." /></label>
                            <label>Téléphone (WhatsApp)<input type="text" name="phone" value="<?php echo esc_attr($eff['phone']); ?>" <?php echo $rec ? 'readonly' : ''; ?> placeholder="ex: 21650027157" /></label>
                            <label>Prénom<input type="text" name="first_name" value="<?php echo esc_attr($eff['first_name']); ?>" /></label>
                            <label>Nom<input type="text" name="last_name" value="<?php echo esc_attr($eff['last_name']); ?>" /></label>
                            <label>Email<input type="email" name="email" value="<?php echo esc_attr($eff['email']); ?>" /></label>
                            <label>Entreprise<input type="text" name="company" value="<?php echo esc_attr($eff['company']); ?>" /></label>
                            <label>Profession<input type="text" name="profession" value="<?php echo esc_attr($eff['profession']); ?>" /></label>
                            <label>Fonction<input type="text" name="job_title" value="<?php echo esc_attr($eff['job_title']); ?>" /></label>
                            <label>Ville<input type="text" name="city" value="<?php echo esc_attr($eff['city']); ?>" /></label>
                            <label>Secteur<input type="text" name="sector" value="<?php echo esc_attr($eff['sector']); ?>" /></label>
                            <label class="dw-crm-form-full">Adresse<input type="text" name="address" value="<?php echo esc_attr($eff['address']); ?>" /></label>
                        </div>
                        <div class="dw-crm-section-title">2. Commercial</div>
                        <div class="dw-crm-form-grid">
                            <label>Statut commercial
                                <select name="commercial_status" class="dw-crm-select">
                                    <?php foreach ($sd as $k => $def): ?>
                                    <option value="<?php echo esc_attr($k); ?>" <?php selected($eff['status'], $k); ?>><?php echo esc_html($def[0]); ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </label>
                            <label>Opt-in marketing
                                <select name="opt_in" class="dw-crm-select">
                                    <option value="1" <?php selected($rec ? (int) $rec['opt_in'] : 0, 1); ?>>Oui</option>
                                    <option value="0" <?php selected($rec ? (int) $rec['opt_in'] : 0, 0); ?>>Non / inconnu</option>
                                </select>
                            </label>
                        </div>
                        <p class="dw-crm-note">La qualification commerciale est saisie manuellement (non déduite automatiquement). Repère objectif : <?php echo $o && $o['paid'] > 0 ? 'ce contact a au moins une commande payée (client).' : 'aucune commande payée connue.'; ?></p>

                        <div class="dw-crm-section-title">3. Tags &amp; segments</div>
                        <div class="dw-crm-form-grid">
                            <label class="dw-crm-form-full">Tags (séparés par des virgules)<input type="text" name="tags" value="<?php echo esc_attr($eff['tags']); ?>" placeholder="ex: VIP, relance, salon2026" /></label>
                            <label class="dw-crm-form-full">Segments (séparés par des virgules)<input type="text" name="segments" value="<?php echo esc_attr($eff['segments']); ?>" placeholder="ex: Nord, Grossiste" /></label>
                        </div>

                        <div class="dw-crm-section-title">9. Notes internes</div>
                        <textarea name="notes" rows="4" class="dw-crm-notes-edit" placeholder="Note interne sur ce contact..."><?php echo esc_textarea($eff['notes']); ?></textarea>

                        <button type="submit" class="dw-crm-savebtn-real">💾 Enregistrer la fiche</button>
                        <?php if (!$rec && $norm === ''): ?><p class="dw-crm-note">Renseignez au moins un téléphone : il génère le Lead ID central du contact.</p><?php endif; ?>
                    </form>
                    <?php if ($rec): ?>
                    <form method="post" action="<?php echo esc_url(admin_url('admin.php')); ?>" onsubmit="return confirm('Supprimer définitivement cette fiche CRM ? Le contact restera visible via son activité WhatsApp mais statut, tags et notes seront perdus.');" style="margin-top:10px;">
                        <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                        <input type="hidden" name="dw_wa_action" value="crm_delete_contact" />
                        <input type="hidden" name="contact_id" value="<?php echo esc_attr($rec['contact_id']); ?>" />
                        <button type="submit" class="dw-crm-dangerbtn">Supprimer la fiche CRM</button>
                    </form>
                    <?php endif; ?>
                </div>
                <div class="dw-crm-fiche-col">
                    <div class="dw-crm-section-title">Statistiques</div>
                    <div class="dw-crm-statgrid">
                        <div class="dw-crm-statbox"><span class="dw-crm-statnum"><?php echo (int) ($o ? $o['total'] : 0); ?></span><span class="dw-crm-statlbl">Commandes</span></div>
                        <div class="dw-crm-statbox"><span class="dw-crm-statnum" style="color:#059669;"><?php echo (int) ($o ? $o['paid'] : 0); ?></span><span class="dw-crm-statlbl">Payées</span></div>
                        <div class="dw-crm-statbox"><span class="dw-crm-statnum"><?php echo $o ? esc_html(number_format((float) $o['sum'], 3, ',', ' ')) : '0'; ?></span><span class="dw-crm-statlbl">Total payé <?php echo $o ? esc_html($o['currency']) : ''; ?></span></div>
                    </div>
                    <div class="dw-crm-row"><span class="dw-crm-key">Messages échangés</span><span class="dw-crm-val"><?php echo (int) count($thread); ?></span></div>
                    <?php if (!empty($eff) && $rec): ?><div class="dw-crm-row"><span class="dw-crm-key">Fiche créée</span><span class="dw-crm-val"><?php echo $rec['created_at'] ? esc_html(self::fmt_time($rec['created_at'], 'd/m/Y H:i')) : '—'; ?></span></div><?php endif; ?>

                    <div class="dw-crm-section-title">Produits achetés</div>
                    <?php if ($o && !empty($o['products'])): foreach ($o['products'] as $pn => $qty): ?>
                        <div class="dw-crm-prod"><span class="dw-crm-prod-name"><?php echo esc_html($pn); ?></span><span class="dw-crm-prod-qty"><?php echo (int) $qty; ?>×</span></div>
                    <?php endforeach; else: ?>
                        <div class="dw-crm-empty">Aucun produit commandé (WooCommerce).</div>
                    <?php endif; ?>

                    <div class="dw-crm-section-title">Commandes récentes</div>
                    <?php if ($o && !empty($o['orders'])): foreach ($o['orders'] as $ord): ?>
                        <a class="dw-crm-order" href="<?php echo esc_url($ord['url']); ?>">
                            <div class="dw-crm-order-top"><span class="dw-crm-order-num">#<?php echo esc_html($ord['number']); ?></span><span class="dw-badge-status <?php echo self::conv_order_badge($ord['status']); ?>" style="font-family:inherit;"><?php echo esc_html(wc_get_order_status_name($ord['status'])); ?></span></div>
                            <div class="dw-crm-order-sub"><?php echo esc_html($ord['product']); ?><?php echo $ord['items'] > 1 ? ' +' . ($ord['items'] - 1) : ''; ?> · <?php echo esc_html(number_format((float) $ord['total'], 3, ',', ' ') . ' ' . $ord['currency']); ?></div>
                        </a>
                    <?php endforeach; else: ?>
                        <div class="dw-crm-empty">Aucune commande associée.</div>
                    <?php endif; ?>

                    <div class="dw-crm-section-title">Activité récente</div>
                    <?php if (empty($thread)): ?>
                        <div class="dw-crm-empty">Aucune activité de messagerie.</div>
                    <?php else: foreach ($thread as $ev):
                        $ets = $ev['at'] ? strtotime($ev['at'] . ' UTC') : 0;
                        if ($ev['dir'] === 'in') { $ic = $ev['st'] === 'opt-out' ? '⛔' : '↩️'; $tx = $ev['st'] === 'opt-out' ? 'Désinscription (opt-out)' : 'Réponse reçue'; }
                        else { $ic = '📤'; $tx = 'Message envoyé'; }
                    ?>
                        <div class="dw-crm-act"><span class="dw-crm-act-ic"><?php echo $ic; ?></span><span class="dw-crm-act-tx"><?php echo esc_html($tx); ?></span><span class="dw-crm-act-wh"><?php echo $ets ? esc_html(date_i18n('d/m/Y H:i', $ets + $tz, true)) : '—'; ?></span></div>
                    <?php endforeach; endif; ?>
                </div>
            </div>
            <?php if ($norm !== '' && $wp['user_id'] === 0 && !$o): ?>
            <p class="dw-crm-note" style="margin-top:12px;">Aucune fiche client WordPress ni commande WooCommerce reliée à ce numéro — contact WhatsApp uniquement. Les informations saisies ci-dessus sont persistées dans le CRM du plugin.</p>
            <?php endif; ?>
        </div>
        <?php
    }

    // ==================================================================
    // CAMPAGNES — Business Center
    // Couche commerciale : définit une campagne (type, audience CRM, message,
    // planification) puis, au lancement, matérialise les envois dans la FILE
    // OPÉRATIONNELLE EXISTANTE du Sender (WASenderQueue::create_bulk_jobs).
    // Ne crée NI seconde file, NI second tracking, NI second gestionnaire de
    // templates. Persistance réelle dans tyy_digiware_whatsapp_bc_campaigns.
    // ==================================================================

    /** Nom de la table des définitions de campagne du Business Center. */
    private static function bc_table() {
        global $wpdb;
        return $wpdb->prefix . 'digiware_whatsapp_bc_campaigns';
    }

    /** Crée la table de définitions si absente (idempotent, additif, sans toucher aux autres modules). */
    private static function bc_ensure_schema() {
        global $wpdb;
        static $done = false;
        if ($done) { return; }
        $done = true;
        $table = self::bc_table();
        $exists = $wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $table));
        if ($exists === $table) { return; }
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL DEFAULT '',
            type VARCHAR(32) NOT NULL DEFAULT 'marketing',
            status VARCHAR(32) NOT NULL DEFAULT 'draft',
            audience_json LONGTEXT,
            audience_count INT(11) NOT NULL DEFAULT 0,
            template_ref VARCHAR(64) NOT NULL DEFAULT '',
            message_content LONGTEXT,
            target_url VARCHAR(500) NOT NULL DEFAULT '',
            schedule_mode VARCHAR(16) NOT NULL DEFAULT 'now',
            scheduled_at DATETIME DEFAULT NULL,
            daily_limit INT(11) NOT NULL DEFAULT 0,
            sender_campaign_id BIGINT(20) UNSIGNED DEFAULT NULL,
            jobs_created INT(11) NOT NULL DEFAULT 0,
            skipped_blacklisted INT(11) NOT NULL DEFAULT 0,
            skipped_optout INT(11) NOT NULL DEFAULT 0,
            invalid_phones INT(11) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            launched_at DATETIME DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_status (status)
        ) {$charset};");
    }

    /** Types de campagne (organisent la campagne, ne déclenchent aucun backend caché). */
    private static function bc_types() {
        return array(
            'marketing'      => 'Marketing',
            'relance'        => 'Relance',
            'enquete'        => 'Enquête',
            'transactionnel' => 'Transactionnel',
        );
    }

    /** Libellés + classes de badge des statuts de campagne. */
    private static function bc_status_defs() {
        return array(
            'draft'     => array('Brouillon',  'dw-st-prospect'),
            'scheduled' => array('Programmée', 'dw-st-relance'),
            'launched'  => array('Lancée',     'dw-st-actif'),
            'failed'    => array('Échouée',    'dw-st-optout'),
        );
    }
    // __BC_MORE__

    /** Charge une définition de campagne (audience décodée) ou null. */
    private static function bc_get($id) {
        self::bc_ensure_schema();
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM " . self::bc_table() . " WHERE id = %d", (int) $id), ARRAY_A);
        if (!$row) { return null; }
        $aud = json_decode((string) $row['audience_json'], true);
        $row['audience'] = is_array($aud) ? $aud : array();
        return $row;
    }

    /** Liste toutes les définitions (plus récentes d'abord). */
    private static function bc_list() {
        self::bc_ensure_schema();
        global $wpdb;
        $rows = $wpdb->get_results("SELECT * FROM " . self::bc_table() . " ORDER BY id DESC", ARRAY_A);
        return is_array($rows) ? $rows : array();
    }

    /** Met à jour des colonnes (updated_at automatique). */
    private static function bc_update($id, array $data) {
        self::bc_ensure_schema();
        global $wpdb;
        $data['updated_at'] = current_time('mysql');
        return $wpdb->update(self::bc_table(), $data, array('id' => (int) $id));
    }

    /** Supprime une définition. */
    private static function bc_delete($id) {
        self::bc_ensure_schema();
        global $wpdb;
        return $wpdb->delete(self::bc_table(), array('id' => (int) $id));
    }

    /** Duplique une définition en brouillon (repart de zéro côté envoi). */
    private static function bc_duplicate($id) {
        $c = self::bc_get($id);
        if (!$c) { return 0; }
        global $wpdb;
        $now = current_time('mysql');
        $wpdb->insert(self::bc_table(), array(
            'name'            => sanitize_text_field($c['name'] . ' (copie)'),
            'type'            => $c['type'],
            'status'          => 'draft',
            'audience_json'   => $c['audience_json'],
            'audience_count'  => (int) $c['audience_count'],
            'template_ref'    => $c['template_ref'],
            'message_content' => $c['message_content'],
            'target_url'      => $c['target_url'],
            'schedule_mode'   => 'now',
            'scheduled_at'    => null,
            'daily_limit'     => (int) $c['daily_limit'],
            'created_at'      => $now,
            'updated_at'      => $now,
        ));
        return (int) $wpdb->insert_id;
    }
    // __BC_MORE2__

    /** Lit les champs de l'assistant (POST) et upsert la définition. Retourne l'id. */
    private static function bc_save_from_post() {
        self::bc_ensure_schema();
        global $wpdb;
        $id   = isset($_POST['bc_id']) ? (int) $_POST['bc_id'] : 0;
        $types = self::bc_types();
        $type = isset($_POST['bc_type']) ? sanitize_key($_POST['bc_type']) : 'marketing';
        if (!isset($types[$type])) { $type = 'marketing'; }
        $name = sanitize_text_field(isset($_POST['bc_name']) ? wp_unslash($_POST['bc_name']) : '');
        if ($name === '') { $name = 'Campagne ' . date_i18n('d/m/Y H:i'); }

        $clean_labels = function($raw) {
            $out = array();
            foreach ((array) $raw as $v) { $v = sanitize_text_field(wp_unslash($v)); if ($v !== '') { $out[] = $v; } }
            return array_values(array_unique($out));
        };
        $audience = array(
            'all'      => (isset($_POST['aud_all']) && $_POST['aud_all'] === '1'),
            'segments' => isset($_POST['aud_segments']) ? $clean_labels($_POST['aud_segments']) : array(),
            'tags'     => isset($_POST['aud_tags']) ? $clean_labels($_POST['aud_tags']) : array(),
            'manual'   => isset($_POST['aud_manual']) ? trim((string) wp_unslash($_POST['aud_manual'])) : '',
        );
        $resolved = self::bc_resolve_audience($audience);

        $schedule_mode = (isset($_POST['schedule_mode']) && $_POST['schedule_mode'] === 'scheduled') ? 'scheduled' : 'now';
        $scheduled_at  = null;
        if ($schedule_mode === 'scheduled' && !empty($_POST['scheduled_at'])) {
            $ts = strtotime(sanitize_text_field(wp_unslash($_POST['scheduled_at'])));
            if ($ts) { $scheduled_at = date('Y-m-d H:i:s', $ts); }
        }
        $status = ($schedule_mode === 'scheduled' && $scheduled_at) ? 'scheduled' : 'draft';

        $data = array(
            'name'            => $name,
            'type'            => $type,
            'status'          => $status,
            'audience_json'   => wp_json_encode($audience),
            'audience_count'  => (int) $resolved['count'],
            'template_ref'    => sanitize_text_field(isset($_POST['bc_template_ref']) ? wp_unslash($_POST['bc_template_ref']) : ''),
            'message_content' => wp_kses_post(wp_unslash(isset($_POST['bc_message']) ? $_POST['bc_message'] : '')),
            'target_url'      => esc_url_raw(isset($_POST['bc_target_url']) ? wp_unslash($_POST['bc_target_url']) : ''),
            'schedule_mode'   => $schedule_mode,
            'scheduled_at'    => $scheduled_at,
            'daily_limit'     => isset($_POST['daily_limit']) ? max(0, (int) $_POST['daily_limit']) : 0,
            'updated_at'      => current_time('mysql'),
        );
        if ($id && self::bc_get($id)) {
            // Une campagne déjà lancée ne se réécrit pas (ses jobs vivent dans le Sender).
            $cur = self::bc_get($id);
            if ($cur['status'] === 'launched') { return $id; }
            $wpdb->update(self::bc_table(), $data, array('id' => $id));
            return $id;
        }
        $data['created_at'] = current_time('mysql');
        $wpdb->insert(self::bc_table(), $data);
        return (int) $wpdb->insert_id;
    }
    // __BC_MORE3__

    /**
     * Templates disponibles pour SÉLECTION (Campagnes ne gère pas les templates).
     * Source réelle : table digiware_whatsapp_templates (module Templates) + modèles
     * intégrés fournis par TemplateManager. Aucune donnée fictive.
     */
    private static function bc_templates_available() {
        global $wpdb;
        $out = array();
        $t = $wpdb->prefix . 'digiware_whatsapp_templates';
        if ($wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $t)) === $t) {
            // Connexion Campagnes : un template archivé n'est plus proposé comme nouveau.
            $has_status = (bool) $wpdb->get_var($wpdb->prepare("SHOW COLUMNS FROM {$t} LIKE %s", 'status'));
            $where = $has_status ? " WHERE status <> 'archived'" : '';
            foreach ((array) $wpdb->get_results("SELECT template_id, name, content FROM {$t}{$where} ORDER BY id DESC", ARRAY_A) as $r) {
                $out[] = array(
                    'ref'     => 'db:' . $r['template_id'],
                    'name'    => $r['name'],
                    'content' => (string) $r['content'],
                    'source'  => 'Enregistré',
                );
            }
        }
        if (class_exists('\\DigiWare\\WhatsApp\\Preparation\\TemplateManager')) {
            foreach (\DigiWare\WhatsApp\Preparation\TemplateManager::get_default_templates() as $slug => $tpl) {
                $out[] = array(
                    'ref'     => 'builtin:' . $slug,
                    'name'    => $tpl['name'],
                    'content' => (string) $tpl['content'],
                    'source'  => 'Intégré',
                );
            }
        }
        return $out;
    }

    /** Résout le contenu d'un template à partir de sa référence (db:/builtin:). '' sinon. */
    private static function bc_template_content($ref) {
        $ref = (string) $ref;
        if ($ref === '') { return ''; }
        foreach (self::bc_templates_available() as $tpl) {
            if ($tpl['ref'] === $ref) { return $tpl['content']; }
        }
        return '';
    }

    /**
     * Convertit les variables affichées {{prenom}} vers les jetons compris par le
     * moteur d'interpolation partagé du Sender ({prenom}), avant la résolution finale.
     */
    private static function bc_normalize_tokens($text) {
        $map = array(
            '{{prenom}}'=>'{prenom}', '{{nom}}'=>'{nom}', '{{telephone}}'=>'{phone}', '{{tel}}'=>'{phone}',
            '{{entreprise}}'=>'{entreprise}', '{{ville}}'=>'{ville}', '{{profession}}'=>'{profession}',
            '{{civilite}}'=>'{civilite}', '{{specialite}}'=>'{specialite}',
            '{{first_name}}'=>'{prenom}', '{{last_name}}'=>'{nom}', '{{company}}'=>'{entreprise}', '{{city}}'=>'{ville}',
        );
        return str_replace(array_keys($map), array_values($map), (string) $text);
    }
    // __BC_MORE4__

    /** Meta d'un contact (issu du CRM) pour la personnalisation du message. */
    private static function bc_meta_from_row($row) {
        $name = trim((string) (isset($row['name']) ? $row['name'] : ''));
        $prenom = ''; $nom = '';
        if ($name !== '') {
            $parts = preg_split('/\s+/', $name, 2);
            $prenom = $parts[0];
            $nom = isset($parts[1]) ? $parts[1] : '';
        }
        $norm = isset($row['norm']) ? $row['norm'] : self::crm_norm_phone(isset($row['phone']) ? $row['phone'] : '');
        return array(
            'contact_id' => isset($row['contact_id']) ? $row['contact_id'] : ('ct_' . substr(md5($norm), 0, 8)),
            'phone'      => '+' . $norm,
            'prenom'     => $prenom !== '' ? $prenom : (isset($row['first_name']) ? $row['first_name'] : ''),
            'nom'        => $nom !== '' ? $nom : (isset($row['last_name']) ? $row['last_name'] : ''),
            'entreprise' => isset($row['company']) ? $row['company'] : '',
            'ville'      => isset($row['city']) ? $row['city'] : '',
            'specialite' => isset($row['profession']) ? $row['profession'] : '',
            'civilite'   => isset($row['civility']) ? $row['civility'] : '',
        );
    }

    /**
     * Résout l'audience RÉELLE depuis le CRM. Combine plusieurs groupes (tous /
     * segments / tags / saisie manuelle) SANS dupliquer les contacts (dédup par
     * téléphone). Exclut opt-out, opt_in=0 et liste noire du Sender. Retourne
     * eligible[], count, excluded{optout,blacklist,invalid}, matched.
     */
    private static function bc_resolve_audience(array $audience) {
        global $wpdb;
        $all      = !empty($audience['all']);
        $segments = array_map('mb_strtolower', array_map('strval', isset($audience['segments']) ? (array) $audience['segments'] : array()));
        $tags     = array_map('mb_strtolower', array_map('strval', isset($audience['tags']) ? (array) $audience['tags'] : array()));
        $manual   = isset($audience['manual']) ? (string) $audience['manual'] : '';

        // Ensemble des contacts opt-out / non consentants (une seule requête).
        $optout_cids = array();
        $ct = $wpdb->prefix . 'digiware_whatsapp_contacts';
        foreach ((array) $wpdb->get_col("SELECT contact_id FROM {$ct} WHERE opt_in = 0 OR commercial_status = 'optout'") as $cid) {
            $optout_cids[$cid] = true;
        }
        $has_bl = class_exists('\\DigiWare\\WhatsApp\\Sender\\WASenderQueue');

        $eligible = array(); $seen = array();
        $ex = array('optout' => 0, 'blacklist' => 0, 'invalid' => 0);
        $matched = 0;

        $consider = function($norm, $meta_row, $status, $optout_flag) use (&$eligible, &$seen, &$ex, &$matched, &$optout_cids, $has_bl) {
            if ($norm === '' || isset($seen[$norm])) { return; }
            $seen[$norm] = true;
            $matched++;
            $cid = 'ct_' . substr(md5($norm), 0, 8);
            if ($optout_flag || $status === 'optout' || isset($optout_cids[$cid])) { $ex['optout']++; return; }
            if ($has_bl && \DigiWare\WhatsApp\Sender\WASenderQueue::is_blacklisted('+' . $norm)) { $ex['blacklist']++; return; }
            $eligible[] = self::bc_meta_from_row($meta_row);
        };

        // 1) Contacts CRM (tous / par segment / par tag).
        if ($all || !empty($segments) || !empty($tags)) {
            foreach (self::crm_collect_contacts() as $row) {
                $match = $all;
                if (!$match && !empty($segments)) {
                    foreach ((array) $row['segments'] as $s) { if (in_array(mb_strtolower($s), $segments, true)) { $match = true; break; } }
                }
                if (!$match && !empty($tags)) {
                    foreach ((array) $row['tags'] as $tg) { if (in_array(mb_strtolower($tg), $tags, true)) { $match = true; break; } }
                }
                if ($match) { $consider($row['norm'], $row, $row['status'], !empty($row['optout'])); }
            }
        }

        // 2) Saisie manuelle / collage CSV (phone;prenom;entreprise;lien).
        if ($manual !== '' && class_exists('\\DigiWare\\WhatsApp\\Preparation\\CrmConnector')) {
            foreach (\DigiWare\WhatsApp\Preparation\CrmConnector::parse_manual_contacts($manual) as $mc) {
                $norm = self::crm_norm_phone($mc['phone']);
                if ($norm === '') { $ex['invalid']++; continue; }
                $cid = 'ct_' . substr(md5($norm), 0, 8);
                $rec = self::crm_get_record($cid);
                if ($rec) {
                    $row = array('contact_id'=>$cid,'norm'=>$norm,'name'=>trim($rec['first_name'].' '.$rec['last_name']),'company'=>$rec['company'],'city'=>$rec['city'],'profession'=>$rec['profession'],'civility'=>$rec['civility']);
                    $consider($norm, $row, $rec['commercial_status'], false);
                } else {
                    $row = array('contact_id'=>$cid,'norm'=>$norm,'first_name'=>isset($mc['first_name'])?$mc['first_name']:'','last_name'=>isset($mc['last_name'])?$mc['last_name']:'','company'=>isset($mc['company'])?$mc['company']:'');
                    $consider($norm, $row, '', false);
                }
            }
        }

        return array('eligible' => $eligible, 'count' => count($eligible), 'excluded' => $ex, 'matched' => $matched);
    }
    // __BC_MORE5__

    /** Libellé lisible de l'audience définie (pour la liste/le récap). */
    private static function bc_audience_label($audience) {
        if (!is_array($audience)) { $audience = json_decode((string) $audience, true); }
        if (!is_array($audience)) { return '—'; }
        if (!empty($audience['all'])) { return 'Tous les contacts'; }
        $bits = array();
        if (!empty($audience['segments'])) { $bits[] = count($audience['segments']) . ' segment(s)'; }
        if (!empty($audience['tags']))     { $bits[] = count($audience['tags']) . ' tag(s)'; }
        if (!empty($audience['manual']))   {
            $n = 0;
            foreach (preg_split('/[\r\n]+/', trim((string) $audience['manual'])) as $l) { if (trim($l) !== '' && strpos(trim($l), '#') !== 0) { $n++; } }
            if ($n > 0) { $bits[] = $n . ' saisi(s)'; }
        }
        return empty($bits) ? 'Aucune' : implode(' + ', $bits);
    }

    /** Progression RÉELLE d'une campagne côté Sender (jobs wasender). */
    private static function bc_sender_progress($sender_campaign_id) {
        $out = array('total' => 0, 'sent' => 0, 'failed' => 0, 'replies' => 0, 'pct' => 0);
        $sid = (int) $sender_campaign_id;
        if ($sid <= 0) { return $out; }
        global $wpdb;
        $jobs = $wpdb->prefix . 'wasender_jobs';
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) total,
                    SUM(CASE WHEN status IN ('sent','read','delivered') THEN 1 ELSE 0 END) sent,
                    SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END) failed,
                    SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) replies
             FROM {$jobs} WHERE campaign_id = %d", $sid), ARRAY_A);
        if ($row) {
            $out['total']   = (int) $row['total'];
            $out['sent']    = (int) $row['sent'];
            $out['failed']  = (int) $row['failed'];
            $out['replies'] = (int) $row['replies'];
            $done = $out['sent'] + $out['failed'];
            $out['pct'] = $out['total'] > 0 ? (int) round(($done / $out['total']) * 100) : 0;
        }
        return $out;
    }

    /**
     * LANCEMENT RÉEL : résout l'audience éligible, prépare la meta par contact,
     * normalise les variables, puis remet les jobs à la SEULE file opérationnelle
     * existante (WASenderQueue::create_bulk_jobs). Campagnes NE crée PAS de queue,
     * NE contourne AUCUNE protection : opt-out / opt_in=0 / liste noire sont exclus
     * en amont ET revérifiés par le Sender. Retourne un tableau ['ok'=>bool, ...].
     */
    private static function bc_launch($id) {
        $c = self::bc_get($id);
        if (!$c) { return array('ok' => false, 'error' => 'introuvable'); }
        if ($c['status'] === 'launched') { return array('ok' => false, 'error' => 'deja_lancee'); }
        if (!class_exists('\\DigiWare\\WhatsApp\\Sender\\WASenderQueue')) {
            return array('ok' => false, 'error' => 'sender_absent');
        }
        $audience = json_decode((string) $c['audience_json'], true);
        if (!is_array($audience)) { $audience = array(); }
        $res = self::bc_resolve_audience($audience);
        if (empty($res['eligible'])) {
            self::bc_update($id, array('status' => 'failed', 'skipped_optout' => $res['excluded']['optout'], 'skipped_blacklisted' => $res['excluded']['blacklist'], 'invalid_phones' => $res['excluded']['invalid']));
            return array('ok' => false, 'error' => 'audience_vide', 'excluded' => $res['excluded']);
        }

        // Message final (template sélectionné OU message rédigé) → jetons partagés.
        $raw = (string) $c['message_content'];
        if (trim($raw) === '' && $c['template_ref'] !== '') { $raw = self::bc_template_content($c['template_ref']); }
        $template = self::bc_normalize_tokens($raw);
        $template_id = null;
        if (strpos((string) $c['template_ref'], 'db:') === 0) { $template_id = (int) substr($c['template_ref'], 3); }

        $r = \DigiWare\WhatsApp\Sender\WASenderQueue::create_bulk_jobs($c['name'], $template, $res['eligible'], $template_id);
        if (empty($r['success'])) {
            self::bc_update($id, array('status' => 'failed'));
            return array('ok' => false, 'error' => 'queue_echec');
        }
        self::bc_update($id, array(
            'status'              => 'launched',
            'sender_campaign_id'  => (int) $r['campaign_id'],
            'jobs_created'        => (int) $r['jobs_created'],
            'skipped_blacklisted' => (int) $r['skipped_blacklisted'] + $res['excluded']['blacklist'],
            'skipped_optout'      => $res['excluded']['optout'],
            'invalid_phones'      => (int) $r['invalid_phones'] + $res['excluded']['invalid'],
            'audience_count'      => $res['count'],
            'launched_at'         => current_time('mysql'),
        ));
        return array('ok' => true, 'sender_campaign_id' => (int) $r['campaign_id'], 'jobs_created' => (int) $r['jobs_created'], 'excluded' => $res['excluded']);
    }

    /**
     * Balayage des campagnes PROGRAMMÉES arrivées à échéance. Appelé au chargement
     * admin (le hook Admin n'est enregistré que si is_admin() → WP-cron ne peut pas
     * l'atteindre ; on balaye donc de façon honnête à chaque chargement admin).
     */
    private static function bc_process_due_campaigns() {
        global $wpdb;
        $t = self::bc_table();
        if ($wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $t)) !== $t) { return; }
        $now = current_time('mysql');
        $due = (array) $wpdb->get_col($wpdb->prepare(
            "SELECT id FROM {$t} WHERE status = 'scheduled' AND scheduled_at <> '' AND scheduled_at <= %s ORDER BY scheduled_at ASC LIMIT 5", $now));
        foreach ($due as $cid) { self::bc_launch((int) $cid); }
    }

    /** AJAX : compte RÉEL et en direct de l'audience éligible (aperçu wizard). */
    public static function ajax_bc_audience() {
        if (!current_user_can('manage_options')) { wp_send_json_error(array('msg' => 'refuse'), 403); }
        check_ajax_referer('dw_bc_audience', 'nonce');
        $audience = array(
            'all'      => (isset($_POST['aud_all']) && $_POST['aud_all'] === '1'),
            'segments' => isset($_POST['aud_segments']) ? array_map('sanitize_text_field', (array) wp_unslash($_POST['aud_segments'])) : array(),
            'tags'     => isset($_POST['aud_tags']) ? array_map('sanitize_text_field', (array) wp_unslash($_POST['aud_tags'])) : array(),
            'manual'   => isset($_POST['aud_manual']) ? sanitize_textarea_field(wp_unslash($_POST['aud_manual'])) : '',
        );
        $res = self::bc_resolve_audience($audience);
        wp_send_json_success(array('count' => $res['count'], 'matched' => $res['matched'], 'excluded' => $res['excluded']));
    }
    // __BC_RENDER__

    /** Aiguilleur de l'onglet Campagnes : liste / assistant (création|édition) / détail. */
    private static function render_campaigns_tab() {
        self::bc_ensure_schema();
        $action = isset($_GET['action']) ? sanitize_key($_GET['action']) : '';
        $id     = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        if ($action === 'view' && $id)                     { self::render_campaign_detail($id); return; }
        if ($action === 'edit' || $action === 'new')       { self::render_campaign_wizard($id); return; }
        self::render_campaigns_list();
    }

    /** Message flash après une action (aucune donnée fictive, reflète l'action réelle). */
    private static function bc_flash() {
        if (empty($_GET['bc'])) { return; }
        $bc = sanitize_key($_GET['bc']);
        $n  = isset($_GET['n']) ? (int) $_GET['n'] : 0;
        $map = array(
            'saved'        => array('ok',  'Campagne enregistrée.'),
            'scheduled'    => array('ok',  'Campagne programmée. Elle sera lancée automatiquement à l\'échéance (au chargement du Business Center).'),
            'launched'     => array('ok',  'Campagne lancée : ' . $n . ' job(s) placé(s) dans la file du Sender.'),
            'duplicated'   => array('ok',  'Campagne dupliquée en brouillon.'),
            'deleted'      => array('ok',  'Campagne supprimée.'),
            'launch_error' => array('err', 'Lancement impossible : audience éligible vide ou Sender indisponible. Rien n\'a été envoyé.'),
        );
        if (!isset($map[$bc])) { return; }
        list($kind, $msg) = $map[$bc];
        $bg = $kind === 'err' ? '#fee2e2' : '#dcfce7';
        $bd = $kind === 'err' ? '#ef4444' : '#22c55e';
        $fg = $kind === 'err' ? '#991b1b' : '#166534';
        echo '<div style="margin:0 0 16px;padding:12px 16px;border-left:4px solid ' . $bd . ';background:' . $bg . ';color:' . $fg . ';border-radius:6px;font-size:13px;font-weight:600;">' . esc_html($msg) . '</div>';
    }
    // __BC_RENDER_LIST__

    /** VUE 1 — Liste des campagnes : KPIs réels, recherche/filtres, tableau, actions réelles. */
    private static function render_campaigns_list() {
        $rows = self::bc_list();
        $types = self::bc_types();
        $sdefs = self::bc_status_defs();
        $base  = admin_url('admin.php?page=digiware-whatsapp&tab=campaigns');

        // KPIs RÉELS (En cours / Terminées dérivés de la progression Sender).
        $k = array('total'=>0,'draft'=>0,'scheduled'=>0,'running'=>0,'done'=>0,'failed'=>0);
        $prep = array();
        foreach ($rows as $r) {
            $k['total']++;
            $st = $r['status'];
            $prog = self::bc_sender_progress($r['sender_campaign_id']);
            if     ($st === 'draft')     { $k['draft']++; }
            elseif ($st === 'scheduled') { $k['scheduled']++; }
            elseif ($st === 'failed')    { $k['failed']++; }
            elseif ($st === 'launched')  { if ($prog['total'] > 0 && $prog['pct'] >= 100) { $k['done']++; } else { $k['running']++; } }
            $r['_prog'] = $prog;
            $prep[] = $r;
        }
        $kpis = array(
            array('Total', $k['total'], '#0ea5e9'),
            array('Brouillons', $k['draft'], '#64748b'),
            array('Programmées', $k['scheduled'], '#f59e0b'),
            array('En cours', $k['running'], '#8b5cf6'),
            array('Terminées', $k['done'], '#22c55e'),
            array('Échouées', $k['failed'], '#ef4444'),
        );
        ?>
        <?php self::bc_flash(); ?>
        <div class="dw-card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
                <h2 style="margin:0;font-size:18px;font-weight:800;">🚀 Campagnes Multisegments</h2>
                <a class="dw-btn-primary" href="<?php echo esc_url($base . '&action=new'); ?>">+ Nouvelle campagne</a>
            </div>
            <div class="dw-kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:20px;">
                <?php foreach ($kpis as $kp): ?>
                    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:14px;">
                        <div style="font-size:26px;font-weight:800;color:<?php echo $kp[2]; ?>;"><?php echo (int) $kp[1]; ?></div>
                        <div style="font-size:12px;color:#94a3b8;font-weight:600;"><?php echo esc_html($kp[0]); ?></div>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php
        self::bc_render_list_body($prep, $types, $sdefs, $base);
    }

    private static function bc_render_list_body($prep, $types, $sdefs, $base) {
        ?>
            <div class="dw-crm-toolbar" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
                <input type="text" id="dw-bc-search" placeholder="Rechercher une campagne…" style="flex:1;min-width:200px;padding:8px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;" />
                <select id="dw-bc-fstatus" style="padding:8px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;">
                    <option value="">Tous les statuts</option>
                    <?php foreach ($sdefs as $sk => $sd): ?><option value="<?php echo esc_attr($sk); ?>"><?php echo esc_html($sd[0]); ?></option><?php endforeach; ?>
                </select>
                <select id="dw-bc-ftype" style="padding:8px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;">
                    <option value="">Tous les types</option>
                    <?php foreach ($types as $tk => $tl): ?><option value="<?php echo esc_attr($tk); ?>"><?php echo esc_html($tl); ?></option><?php endforeach; ?>
                </select>
            </div>
            <?php if (empty($prep)): ?>
                <div style="padding:40px;text-align:center;color:#64748b;font-size:14px;">Aucune campagne pour le moment. Cliquez sur « + Nouvelle campagne » pour en créer une.</div>
            <?php else: ?>
            <table class="dw-table" id="dw-bc-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="text-align:left;color:#94a3b8;border-bottom:1px solid #1e293b;">
                    <th style="padding:10px;">Nom</th><th style="padding:10px;">Type</th><th style="padding:10px;">Audience</th>
                    <th style="padding:10px;">Statut</th><th style="padding:10px;">Progression</th><th style="padding:10px;">Envoyés</th>
                    <th style="padding:10px;">Réponses</th><th style="padding:10px;">Date</th><th style="padding:10px;">Actions</th>
                </tr></thead>
                <tbody>
                <?php foreach ($prep as $r): $prog = $r['_prog'];
                    $sd = isset($sdefs[$r['status']]) ? $sdefs[$r['status']] : array(ucfirst($r['status']), 'dw-st-prospect');
                    $slabel = $sd[0];
                    if ($r['status'] === 'launched') { $slabel = ($prog['total'] > 0 && $prog['pct'] >= 100) ? 'Terminée' : 'En cours'; }
                    $date = $r['status'] === 'scheduled' ? $r['scheduled_at'] : ($r['launched_at'] ? $r['launched_at'] : $r['created_at']);
                    $aud_label = self::bc_audience_label(isset($r['audience']) ? $r['audience'] : $r['audience_json']);
                    $can_edit = ($r['status'] !== 'launched');
                    ?>
                    <tr class="dw-bc-row" data-name="<?php echo esc_attr(mb_strtolower($r['name'])); ?>" data-status="<?php echo esc_attr($r['status']); ?>" data-type="<?php echo esc_attr($r['type']); ?>" style="border-bottom:1px solid #1e293b;">
                        <td style="padding:10px;font-weight:700;color:#e2e8f0;"><?php echo esc_html($r['name']); ?></td>
                        <td style="padding:10px;color:#cbd5e1;"><?php echo esc_html(isset($types[$r['type']]) ? $types[$r['type']] : $r['type']); ?></td>
                        <td style="padding:10px;color:#cbd5e1;"><?php echo esc_html($aud_label); ?> <span style="color:#64748b;">(<?php echo (int) $r['audience_count']; ?>)</span></td>
                        <td style="padding:10px;"><span class="dw-badge <?php echo esc_attr($sd[1]); ?>"><?php echo esc_html($slabel); ?></span></td>
                        <td style="padding:10px;min-width:110px;">
                            <?php if ($r['status'] === 'launched' && $prog['total'] > 0): ?>
                                <div style="background:#1e293b;border-radius:6px;height:8px;overflow:hidden;"><div style="height:8px;background:#22c55e;width:<?php echo (int) $prog['pct']; ?>%;"></div></div>
                                <span style="font-size:11px;color:#94a3b8;"><?php echo (int) $prog['pct']; ?>%</span>
                            <?php else: ?><span style="color:#64748b;">—</span><?php endif; ?>
                        </td>
                        <td style="padding:10px;color:#cbd5e1;"><?php echo $r['status'] === 'launched' ? ((int) $prog['sent'] . ' / ' . (int) $prog['total']) : '0'; ?></td>
                        <td style="padding:10px;color:#cbd5e1;"><?php echo $r['status'] === 'launched' ? (int) $prog['replies'] : '0'; ?></td>
                        <td style="padding:10px;color:#94a3b8;white-space:nowrap;"><?php echo esc_html($date ? date_i18n('d/m/Y H:i', strtotime($date)) : '—'); ?></td>
                        <td style="padding:10px;white-space:nowrap;">
                            <a href="<?php echo esc_url($base . '&action=view&id=' . (int) $r['id']); ?>" style="color:#38bdf8;text-decoration:none;font-weight:600;margin-right:8px;">Détail</a>
                            <?php if ($can_edit): ?><a href="<?php echo esc_url($base . '&action=edit&id=' . (int) $r['id']); ?>" style="color:#a78bfa;text-decoration:none;font-weight:600;margin-right:8px;">Modifier</a><?php endif; ?>
                            <?php self::bc_row_form($base, 'bc_campaign_duplicate', (int) $r['id'], 'Dupliquer', '#facc15'); ?>
                            <?php if ($can_edit): self::bc_row_form($base, 'bc_campaign_delete', (int) $r['id'], 'Supprimer', '#f87171', true); endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
        </div>
        <?php self::bc_list_js(); ?>
        <?php
    }

    /** Petit formulaire POST (nonce réel) pour une action de ligne (dupliquer/supprimer). */
    private static function bc_row_form($base, $action, $id, $label, $color, $confirm = false) {
        ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin.php')); ?>" style="display:inline;" <?php if ($confirm): ?>onsubmit="return confirm('Supprimer cette campagne ? Action définitive.');"<?php endif; ?>>
            <?php wp_nonce_field('dw_wa_action_nonce'); ?>
            <input type="hidden" name="dw_wa_action" value="<?php echo esc_attr($action); ?>" />
            <input type="hidden" name="id" value="<?php echo (int) $id; ?>" />
            <button type="submit" style="background:none;border:none;padding:0;cursor:pointer;color:<?php echo $color; ?>;font-weight:600;font-size:13px;margin-right:8px;"><?php echo esc_html($label); ?></button>
        </form>
        <?php
    }

    private static function bc_list_js() {
        ?>
        <script>(function(){
            var s=document.getElementById('dw-bc-search'),fs=document.getElementById('dw-bc-fstatus'),ft=document.getElementById('dw-bc-ftype');
            if(!s)return;
            function apply(){var q=(s.value||'').toLowerCase(),st=fs.value,ty=ft.value;
                document.querySelectorAll('#dw-bc-table .dw-bc-row').forEach(function(r){
                    var ok=(!q||r.dataset.name.indexOf(q)>=0)&&(!st||r.dataset.status===st)&&(!ty||r.dataset.type===ty);
                    r.style.display=ok?'':'none';});}
            [s,fs,ft].forEach(function(e){e.addEventListener('input',apply);e.addEventListener('change',apply);});
        })();</script>
        <?php
    }
    // __BC_RENDER_WIZARD__

    /** VUES 2→6 — Assistant en une seule page (5 étapes, un seul formulaire). */
    private static function render_campaign_wizard($id) {
        $c = $id ? self::bc_get($id) : null;
        if ($c && $c['status'] === 'launched') { self::render_campaign_detail($id); return; }
        $base  = admin_url('admin.php?page=digiware-whatsapp&tab=campaigns');
        $types = self::bc_types();
        $segs  = self::crm_segment_catalog();
        $tags  = self::crm_tag_catalog();
        $tpls  = self::bc_templates_available();
        $aud   = $c ? (isset($c['audience']) ? $c['audience'] : array()) : array();
        $cur = array(
            'name'          => $c ? $c['name'] : '',
            'type'          => $c ? $c['type'] : 'marketing',
            'all'           => !empty($aud['all']),
            'segments'      => isset($aud['segments']) ? (array) $aud['segments'] : array(),
            'tags'          => isset($aud['tags']) ? (array) $aud['tags'] : array(),
            'manual'        => isset($aud['manual']) ? (string) $aud['manual'] : '',
            'template_ref'  => $c ? $c['template_ref'] : '',
            'message'       => $c ? $c['message_content'] : '',
            'target_url'    => $c ? $c['target_url'] : '',
            'schedule_mode' => $c ? $c['schedule_mode'] : 'now',
            'scheduled_at'  => ($c && $c['scheduled_at']) ? date('Y-m-d\TH:i', strtotime($c['scheduled_at'])) : '',
            'daily_limit'   => $c ? (int) $c['daily_limit'] : 0,
        );
        $nonce = wp_create_nonce('dw_bc_audience');
        $steps = array('Type', 'Audience', 'Message', 'Planification', 'Confirmation');
        ?>
        <?php self::bc_flash(); ?>
        <div class="dw-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
                <h2 style="margin:0;font-size:18px;font-weight:800;"><?php echo $c ? 'Modifier la campagne' : 'Nouvelle campagne'; ?></h2>
                <a href="<?php echo esc_url($base); ?>" style="color:#94a3b8;text-decoration:none;font-weight:600;">← Retour à la liste</a>
            </div>
            <div id="dw-bc-stepper" style="display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap;">
                <?php foreach ($steps as $i => $st): ?>
                    <div class="dw-bc-stephead" data-step="<?php echo $i; ?>" style="flex:1;min-width:120px;padding:10px;border-radius:8px;text-align:center;font-size:12px;font-weight:700;background:<?php echo $i === 0 ? '#1d4ed8' : '#0f172a'; ?>;color:<?php echo $i === 0 ? '#fff' : '#94a3b8'; ?>;border:1px solid #1e293b;cursor:pointer;">
                        <?php echo ($i + 1) . '. ' . esc_html($st); ?>
                    </div>
                <?php endforeach; ?>
            </div>
            <form method="post" action="<?php echo esc_url(admin_url('admin.php')); ?>" id="dw-bc-form">
                <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                <input type="hidden" name="bc_id" value="<?php echo (int) $id; ?>" />

                <!-- ÉTAPE 1 : TYPE -->
                <div class="dw-bc-step" data-step="0">
                    <label style="display:block;font-weight:700;margin-bottom:6px;color:#e2e8f0;">Nom de la campagne</label>
                    <input type="text" name="bc_name" value="<?php echo esc_attr($cur['name']); ?>" placeholder="Ex. Relance clients inactifs — Octobre" style="width:100%;padding:10px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;margin-bottom:18px;" />
                    <label style="display:block;font-weight:700;margin-bottom:6px;color:#e2e8f0;">Type de campagne</label>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
                        <?php foreach ($types as $tk => $tl): ?>
                            <label style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid #334155;border-radius:8px;background:#0f172a;cursor:pointer;color:#e2e8f0;">
                                <input type="radio" name="bc_type" value="<?php echo esc_attr($tk); ?>" <?php checked($cur['type'], $tk); ?> />
                                <?php echo esc_html($tl); ?>
                            </label>
                        <?php endforeach; ?>
                    </div>
                </div>
    // __BC_RENDER_WIZARD2__

                <!-- ÉTAPE 2 : AUDIENCE (depuis le CRM réel) -->
                <div class="dw-bc-step" data-step="1" style="display:none;">
                    <p style="color:#94a3b8;font-size:13px;margin-top:0;">Composez l'audience à partir du CRM. Les groupes se cumulent <strong>sans doublon</strong>. Les contacts opt-out, non consentants (opt_in = non) et en liste noire sont <strong>automatiquement exclus</strong>.</p>
                    <label style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid #334155;border-radius:8px;background:#0f172a;cursor:pointer;color:#e2e8f0;margin-bottom:14px;">
                        <input type="checkbox" id="dw-aud-all" name="aud_all" value="1" <?php checked($cur['all']); ?> />
                        <strong>Tous les contacts CRM</strong>
                    </label>
                    <div id="dw-aud-groups" style="<?php echo $cur['all'] ? 'opacity:.4;pointer-events:none;' : ''; ?>">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                            <div>
                                <div style="font-weight:700;color:#e2e8f0;margin-bottom:6px;">Segments</div>
                                <?php if (empty($segs)): ?><div style="color:#64748b;font-size:12px;">Aucun segment. Créez-en dans CRM &amp; Contacts.</div><?php else: ?>
                                    <div style="max-height:160px;overflow:auto;border:1px solid #1e293b;border-radius:8px;padding:8px;">
                                    <?php foreach ($segs as $sg): ?>
                                        <label style="display:flex;align-items:center;gap:8px;padding:4px;color:#cbd5e1;font-size:13px;">
                                            <input type="checkbox" class="dw-aud-input" name="aud_segments[]" value="<?php echo esc_attr($sg); ?>" <?php checked(in_array($sg, $cur['segments'], true)); ?> /> <?php echo esc_html($sg); ?>
                                        </label>
                                    <?php endforeach; ?>
                                    </div>
                                <?php endif; ?>
                            </div>
                            <div>
                                <div style="font-weight:700;color:#e2e8f0;margin-bottom:6px;">Tags</div>
                                <?php if (empty($tags)): ?><div style="color:#64748b;font-size:12px;">Aucun tag. Créez-en dans CRM &amp; Contacts.</div><?php else: ?>
                                    <div style="max-height:160px;overflow:auto;border:1px solid #1e293b;border-radius:8px;padding:8px;">
                                    <?php foreach ($tags as $tg): ?>
                                        <label style="display:flex;align-items:center;gap:8px;padding:4px;color:#cbd5e1;font-size:13px;">
                                            <input type="checkbox" class="dw-aud-input" name="aud_tags[]" value="<?php echo esc_attr($tg); ?>" <?php checked(in_array($tg, $cur['tags'], true)); ?> /> <?php echo esc_html($tg); ?>
                                        </label>
                                    <?php endforeach; ?>
                                    </div>
                                <?php endif; ?>
                            </div>
                        </div>
                        <div style="margin-top:16px;">
                            <div style="font-weight:700;color:#e2e8f0;margin-bottom:6px;">Saisie manuelle / import CSV <span style="color:#64748b;font-weight:400;">(une ligne par contact : <code>téléphone;prénom;entreprise;lien</code>)</span></div>
                            <textarea id="dw-aud-manual" name="aud_manual" rows="4" placeholder="+21650027157;Iheb;DigiWare&#10;+21612345678;Sana" class="dw-aud-input" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;font-family:monospace;"><?php echo esc_textarea($cur['manual']); ?></textarea>
                        </div>
                    </div>
                    <div id="dw-aud-count" data-nonce="<?php echo esc_attr($nonce); ?>" style="margin-top:16px;padding:14px;border-radius:8px;background:#0f172a;border:1px solid #1e293b;color:#e2e8f0;font-size:14px;">
                        Audience éligible : <strong id="dw-aud-n">—</strong> contact(s)
                        <span id="dw-aud-ex" style="color:#94a3b8;font-size:12px;margin-left:8px;"></span>
                    </div>
                </div>
    // __BC_RENDER_WIZARD3__

                <!-- ÉTAPE 3 : MESSAGE -->
                <div class="dw-bc-step" data-step="2" style="display:none;">
                    <p style="color:#94a3b8;font-size:13px;margin-top:0;">Sélectionnez un template existant (module Templates) <strong>ou</strong> rédigez un message. Campagnes ne gère pas les templates : elle les réutilise.</p>
                    <label style="display:block;font-weight:700;margin-bottom:6px;color:#e2e8f0;">Template</label>
                    <select id="dw-bc-tpl" name="bc_template_ref" style="width:100%;padding:10px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;margin-bottom:14px;">
                        <option value="">— Message libre (ci-dessous) —</option>
                        <?php foreach ($tpls as $tpl): ?>
                            <option value="<?php echo esc_attr($tpl['ref']); ?>" data-content="<?php echo esc_attr($tpl['content']); ?>" <?php selected($cur['template_ref'], $tpl['ref']); ?>>
                                <?php echo esc_html($tpl['name'] . ' (' . $tpl['source'] . ')'); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                    <label style="display:block;font-weight:700;margin-bottom:6px;color:#e2e8f0;">Message</label>
                    <textarea id="dw-bc-msg" name="bc_message" rows="6" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;"><?php echo esc_textarea($cur['message']); ?></textarea>
                    <div style="margin:8px 0 14px;font-size:12px;color:#94a3b8;">
                        Variables : <?php foreach (array('{{prenom}}','{{nom}}','{{telephone}}','{{entreprise}}','{{ville}}','{{profession}}') as $v): ?>
                            <code class="dw-bc-var" style="cursor:pointer;background:#1e293b;padding:2px 6px;border-radius:4px;margin-right:4px;"><?php echo esc_html($v); ?></code>
                        <?php endforeach; ?>
                        <div style="margin-top:6px;">Résolues pour chaque contact <strong>avant l'envoi</strong> par le moteur du Sender (le Sender ne porte aucune logique CRM).</div>
                    </div>
                    <label style="display:block;font-weight:700;margin-bottom:6px;color:#e2e8f0;">Lien à inclure (facultatif)</label>
                    <input type="url" name="bc_target_url" value="<?php echo esc_attr($cur['target_url']); ?>" placeholder="https://…" style="width:100%;padding:10px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;margin-bottom:14px;" />
                    <div style="font-weight:700;color:#e2e8f0;margin-bottom:6px;">Aperçu</div>
                    <div id="dw-bc-preview" style="padding:12px;border-radius:8px;background:#064e3b;color:#d1fae5;font-size:13px;white-space:pre-wrap;min-height:40px;"></div>
                </div>
    // __BC_RENDER_WIZARD4__

                <!-- ÉTAPE 4 : PLANIFICATION -->
                <div class="dw-bc-step" data-step="3" style="display:none;">
                    <label style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid #334155;border-radius:8px;background:#0f172a;cursor:pointer;color:#e2e8f0;margin-bottom:10px;">
                        <input type="radio" name="schedule_mode" value="now" <?php checked($cur['schedule_mode'], 'now'); ?> /> <strong>Envoyer maintenant</strong> — les jobs sont créés dès le lancement.
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;padding:12px;border:1px solid #334155;border-radius:8px;background:#0f172a;cursor:pointer;color:#e2e8f0;margin-bottom:14px;">
                        <input type="radio" name="schedule_mode" value="scheduled" <?php checked($cur['schedule_mode'], 'scheduled'); ?> /> <strong>Programmer</strong> à une date/heure précise.
                    </label>
                    <div id="dw-bc-sched" style="<?php echo $cur['schedule_mode'] === 'scheduled' ? '' : 'display:none;'; ?>margin-bottom:14px;">
                        <label style="display:block;font-weight:700;margin-bottom:6px;color:#e2e8f0;">Date et heure d'envoi</label>
                        <input type="datetime-local" name="scheduled_at" value="<?php echo esc_attr($cur['scheduled_at']); ?>" style="padding:10px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;" />
                        <p style="font-size:12px;color:#94a3b8;">La campagne est lancée automatiquement à l'échéance, au prochain chargement du Business Center.</p>
                    </div>
                    <label style="display:block;font-weight:700;margin-bottom:6px;color:#e2e8f0;">Cadence — nombre max de messages / jour <span style="color:#64748b;font-weight:400;">(0 = pas de limite ; la temporisation anti-spam reste gérée par le Sender)</span></label>
                    <input type="number" min="0" name="daily_limit" value="<?php echo (int) $cur['daily_limit']; ?>" style="width:160px;padding:10px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;" />
                </div>

                <!-- ÉTAPE 5 : CONFIRMATION -->
                <div class="dw-bc-step" data-step="4" style="display:none;">
                    <p style="color:#94a3b8;font-size:13px;margin-top:0;">Vérifiez le récapitulatif. « Lancer » valide, détermine les contacts éligibles, résout les variables et place les jobs dans la file du Sender.</p>
                    <div id="dw-bc-recap" style="display:grid;gap:8px;padding:16px;border-radius:8px;background:#0f172a;border:1px solid #1e293b;color:#e2e8f0;font-size:13px;">
                        <div>Nom : <strong id="rc-name">—</strong></div>
                        <div>Type : <strong id="rc-type">—</strong></div>
                        <div>Audience éligible : <strong id="rc-aud">—</strong> contact(s)</div>
                        <div>Message : <strong id="rc-msg">—</strong></div>
                        <div>Planification : <strong id="rc-sched">—</strong></div>
                    </div>
                    <div style="background:#78350f;color:#fed7aa;padding:10px 12px;border-radius:8px;font-size:12px;margin-top:12px;">
                        Conformité : seuls les contacts consentants et non blacklistés reçoivent le message. Aucun mécanisme de contournement des limites WhatsApp n'est utilisé.
                    </div>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:10px;">
                    <button type="button" id="dw-bc-prev" style="padding:10px 18px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;font-weight:700;cursor:pointer;">← Précédent</button>
                    <div style="display:flex;gap:10px;">
                        <button type="submit" name="dw_wa_action" value="bc_campaign_save" class="dw-btn-secondary" style="padding:10px 18px;border:1px solid #334155;border-radius:8px;background:#1e293b;color:#e2e8f0;font-weight:700;cursor:pointer;">Enregistrer le brouillon</button>
                        <button type="button" id="dw-bc-next" class="dw-btn-primary" style="padding:10px 18px;">Suivant →</button>
                        <button type="submit" name="dw_wa_action" value="bc_campaign_launch" id="dw-bc-launch" class="dw-btn-primary" style="padding:10px 18px;display:none;background:#16a34a;">🚀 Lancer la campagne</button>
                    </div>
                </div>
            </form>
        </div>
        <?php self::bc_wizard_js(); ?>
        <?php
    }
    // __BC_RENDER_WIZARD_JS__

    private static function bc_wizard_js() {
        ?>
        <script>(function(){
            var form=document.getElementById('dw-bc-form'); if(!form)return;
            var steps=[].slice.call(form.querySelectorAll('.dw-bc-step'));
            var heads=[].slice.call(document.querySelectorAll('.dw-bc-stephead'));
            var prev=document.getElementById('dw-bc-prev'),next=document.getElementById('dw-bc-next'),launch=document.getElementById('dw-bc-launch');
            var cur=0,last=steps.length-1;
            function show(i){cur=Math.max(0,Math.min(last,i));
                steps.forEach(function(s,k){s.style.display=k===cur?'':'none';});
                heads.forEach(function(h,k){h.style.background=k===cur?'#1d4ed8':'#0f172a';h.style.color=k===cur?'#fff':'#94a3b8';});
                prev.style.display=cur===0?'none':'';
                next.style.display=cur===last?'none':'';
                launch.style.display=cur===last?'':'none';
                if(cur===1){refreshCount();}
                if(cur===last){recap();}
            }
            heads.forEach(function(h){h.addEventListener('click',function(){show(parseInt(h.dataset.step,10));});});
            prev.addEventListener('click',function(){show(cur-1);});
            next.addEventListener('click',function(){show(cur+1);});

            // Étape planification : afficher le sélecteur de date si "Programmer".
            form.querySelectorAll('[name=schedule_mode]').forEach(function(r){r.addEventListener('change',function(){
                document.getElementById('dw-bc-sched').style.display=(form.querySelector('[name=schedule_mode]:checked').value==='scheduled')?'':'none';});});

            // Étape audience : "Tous" désactive les groupes.
            var allCb=document.getElementById('dw-aud-all'),groups=document.getElementById('dw-aud-groups');
            function syncAll(){var on=allCb.checked;groups.style.opacity=on?'.4':'';groups.style.pointerEvents=on?'none':'';refreshCount();}
            if(allCb){allCb.addEventListener('change',syncAll);}

            // Insertion d'une variable dans le message au clic.
            var msg=document.getElementById('dw-bc-msg');
            document.querySelectorAll('.dw-bc-var').forEach(function(v){v.addEventListener('click',function(){
                if(!msg)return;var t=v.textContent;var p=msg.selectionStart||msg.value.length;
                msg.value=msg.value.slice(0,p)+t+msg.value.slice(p);preview();});});
    // __BC_WIZARD_JS2__

            // Sélection d'un template : pré-remplit le message (l'utilisateur peut ajuster).
            var tplSel=document.getElementById('dw-bc-tpl');
            if(tplSel){tplSel.addEventListener('change',function(){
                var o=tplSel.options[tplSel.selectedIndex];var c=o?o.getAttribute('data-content'):'';
                if(c){msg.value=c;}preview();});}

            // Aperçu : substitution d'exemple des variables (démonstration, non envoyé).
            function preview(){var box=document.getElementById('dw-bc-preview');if(!box||!msg)return;
                var t=msg.value.replace(/\{\{\s*prenom\s*\}\}/gi,'Iheb').replace(/\{\{\s*nom\s*\}\}/gi,'Ben Aoun')
                    .replace(/\{\{\s*telephone\s*\}\}/gi,'+21650027157').replace(/\{\{\s*entreprise\s*\}\}/gi,'DigiWare')
                    .replace(/\{\{\s*ville\s*\}\}/gi,'Tunis').replace(/\{\{\s*profession\s*\}\}/gi,'Gérant');
                box.textContent=t||'(message vide)';}
            if(msg){msg.addEventListener('input',preview);preview();}

            // Compte RÉEL de l'audience éligible (AJAX serveur, aucune estimation front).
            var nonce=document.getElementById('dw-aud-count')?document.getElementById('dw-aud-count').dataset.nonce:'';
            var t=null;
            function refreshCount(){
                var nEl=document.getElementById('dw-aud-n'),exEl=document.getElementById('dw-aud-ex');
                if(!nEl)return;nEl.textContent='…';
                var fd=new FormData();fd.append('action','dw_bc_audience');fd.append('nonce',nonce);
                fd.append('aud_all',allCb&&allCb.checked?'1':'0');
                fd.append('aud_manual',(document.getElementById('dw-aud-manual')||{}).value||'');
                form.querySelectorAll('[name="aud_segments[]"]:checked').forEach(function(c){fd.append('aud_segments[]',c.value);});
                form.querySelectorAll('[name="aud_tags[]"]:checked').forEach(function(c){fd.append('aud_tags[]',c.value);});
                fetch(ajaxurl,{method:'POST',credentials:'same-origin',body:fd}).then(function(r){return r.json();}).then(function(j){
                    if(j&&j.success){nEl.textContent=j.data.count;
                        var e=j.data.excluded;exEl.textContent='(exclus : '+e.optout+' opt-out, '+e.blacklist+' liste noire, '+e.invalid+' invalides)';}
                    else{nEl.textContent='0';}}).catch(function(){nEl.textContent='?';});
            }
            form.querySelectorAll('.dw-aud-input').forEach(function(e){
                e.addEventListener('change',function(){clearTimeout(t);t=setTimeout(refreshCount,350);});
                e.addEventListener('input',function(){clearTimeout(t);t=setTimeout(refreshCount,600);});});

            // Récapitulatif (étape 5).
            function txt(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
            function recap(){
                txt('rc-name',(form.bc_name.value||'(sans nom)'));
                var ty=form.querySelector('[name=bc_type]:checked');txt('rc-type',ty?ty.parentNode.textContent.trim():'—');
                txt('rc-aud',(document.getElementById('dw-aud-n')||{}).textContent||'—');
                var m=(msg.value||'').slice(0,80);txt('rc-msg',m?(m+(msg.value.length>80?'…':'')):'(vide)');
                var sm=form.querySelector('[name=schedule_mode]:checked');
                txt('rc-sched',sm&&sm.value==='scheduled'?('Programmée : '+(form.scheduled_at.value||'?')):'Envoi immédiat');
            }
            show(0);
        })();</script>
        <?php
    }
    // __BC_DETAIL__

    /** VUE détail / suivi d'une campagne : récap + progression RÉELLE côté Sender. */
    private static function render_campaign_detail($id) {
        $c = self::bc_get($id);
        $base = admin_url('admin.php?page=digiware-whatsapp&tab=campaigns');
        if (!$c) {
            echo '<div class="dw-card"><p>Campagne introuvable. <a href="' . esc_url($base) . '">← Retour</a></p></div>';
            return;
        }
        $types = self::bc_types();
        $sdefs = self::bc_status_defs();
        $prog  = self::bc_sender_progress($c['sender_campaign_id']);
        $sd    = isset($sdefs[$c['status']]) ? $sdefs[$c['status']] : array(ucfirst($c['status']), 'dw-st-prospect');
        $slabel = $sd[0];
        if ($c['status'] === 'launched') { $slabel = ($prog['total'] > 0 && $prog['pct'] >= 100) ? 'Terminée' : 'En cours'; }
        $raw = (string) $c['message_content'];
        if (trim($raw) === '' && $c['template_ref'] !== '') { $raw = self::bc_template_content($c['template_ref']); }
        ?>
        <?php self::bc_flash(); ?>
        <div class="dw-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px;">
                <h2 style="margin:0;font-size:18px;font-weight:800;"><?php echo esc_html($c['name']); ?> <span class="dw-badge <?php echo esc_attr($sd[1]); ?>" style="margin-left:8px;"><?php echo esc_html($slabel); ?></span></h2>
                <a href="<?php echo esc_url($base); ?>" style="color:#94a3b8;text-decoration:none;font-weight:600;">← Retour à la liste</a>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;">
                <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px;color:#e2e8f0;font-size:13px;">
                    <div style="font-weight:700;margin-bottom:10px;">Définition</div>
                    <div style="margin-bottom:6px;">Type : <strong><?php echo esc_html(isset($types[$c['type']]) ? $types[$c['type']] : $c['type']); ?></strong></div>
                    <div style="margin-bottom:6px;">Audience : <strong><?php echo esc_html(self::bc_audience_label($c['audience'])); ?></strong> (<?php echo (int) $c['audience_count']; ?> éligibles à l'enregistrement)</div>
                    <div style="margin-bottom:6px;">Planification : <strong><?php echo $c['schedule_mode'] === 'scheduled' ? esc_html('Programmée · ' . $c['scheduled_at']) : 'Envoi immédiat'; ?></strong></div>
                    <div style="margin-bottom:6px;">Créée : <?php echo esc_html($c['created_at']); ?><?php echo $c['launched_at'] ? ' · Lancée : ' . esc_html($c['launched_at']) : ''; ?></div>
                </div>
                <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px;color:#e2e8f0;font-size:13px;">
                    <div style="font-weight:700;margin-bottom:10px;">Message</div>
                    <div style="white-space:pre-wrap;color:#cbd5e1;"><?php echo esc_html($raw !== '' ? $raw : '(vide)'); ?></div>
                    <?php if ($c['target_url']): ?><div style="margin-top:8px;">Lien : <a href="<?php echo esc_url($c['target_url']); ?>" style="color:#38bdf8;"><?php echo esc_html($c['target_url']); ?></a></div><?php endif; ?>
                </div>
            </div>
            <?php if ($c['status'] === 'launched'): ?>
                <div style="font-weight:700;color:#e2e8f0;margin-bottom:8px;">Progression réelle (file Sender #<?php echo (int) $c['sender_campaign_id']; ?>)</div>
                <div style="background:#1e293b;border-radius:6px;height:12px;overflow:hidden;margin-bottom:6px;"><div style="height:12px;background:#22c55e;width:<?php echo (int) $prog['pct']; ?>%;"></div></div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:12px;">
                    <?php
                    $cells = array(
                        array('Total jobs', $prog['total'], '#0ea5e9'),
                        array('Envoyés', $prog['sent'], '#22c55e'),
                        array('Réponses', $prog['replies'], '#a78bfa'),
                        array('Échecs', $prog['failed'], '#ef4444'),
                        array('Exclus opt-out', (int) $c['skipped_optout'], '#f59e0b'),
                        array('Exclus liste noire', (int) $c['skipped_blacklisted'], '#f59e0b'),
                    );
                    foreach ($cells as $ce): ?>
                        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:12px;">
                            <div style="font-size:22px;font-weight:800;color:<?php echo $ce[2]; ?>;"><?php echo (int) $ce[1]; ?></div>
                            <div style="font-size:12px;color:#94a3b8;font-weight:600;"><?php echo esc_html($ce[0]); ?></div>
                        </div>
                    <?php endforeach; ?>
                </div>
                <p style="font-size:12px;color:#64748b;margin-top:10px;">Les envois sont exécutés par le Sender (pupitre/moteur). Cette vue reflète l'état réel des jobs <code>wasender_jobs</code> ; « Réponses » = jobs passés en <code>read</code> (une réponse prouve la lecture).</p>
            <?php else: ?>
                <div style="display:flex;gap:10px;">
                    <a href="<?php echo esc_url($base . '&action=edit&id=' . (int) $c['id']); ?>" class="dw-btn-secondary" style="padding:10px 18px;border:1px solid #334155;border-radius:8px;background:#1e293b;color:#e2e8f0;font-weight:700;text-decoration:none;">Modifier</a>
                    <form method="post" action="<?php echo esc_url(admin_url('admin.php')); ?>" style="display:inline;">
                        <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                        <input type="hidden" name="dw_wa_action" value="bc_campaign_launch" />
                        <input type="hidden" name="bc_id" value="<?php echo (int) $c['id']; ?>" />
                        <input type="hidden" name="bc_name" value="<?php echo esc_attr($c['name']); ?>" />
                        <input type="hidden" name="bc_type" value="<?php echo esc_attr($c['type']); ?>" />
                        <input type="hidden" name="bc_template_ref" value="<?php echo esc_attr($c['template_ref']); ?>" />
                        <input type="hidden" name="bc_message" value="<?php echo esc_attr($c['message_content']); ?>" />
                        <input type="hidden" name="bc_target_url" value="<?php echo esc_attr($c['target_url']); ?>" />
                        <input type="hidden" name="schedule_mode" value="now" />
                        <?php if (!empty($c['audience']['all'])): ?><input type="hidden" name="aud_all" value="1" /><?php endif; ?>
                        <?php foreach ((array) (isset($c['audience']['segments']) ? $c['audience']['segments'] : array()) as $sv): ?><input type="hidden" name="aud_segments[]" value="<?php echo esc_attr($sv); ?>" /><?php endforeach; ?>
                        <?php foreach ((array) (isset($c['audience']['tags']) ? $c['audience']['tags'] : array()) as $tv): ?><input type="hidden" name="aud_tags[]" value="<?php echo esc_attr($tv); ?>" /><?php endforeach; ?>
                        <input type="hidden" name="aud_manual" value="<?php echo esc_attr(isset($c['audience']['manual']) ? $c['audience']['manual'] : ''); ?>" />
                        <button type="submit" class="dw-btn-primary" style="padding:10px 18px;background:#16a34a;" onclick="return confirm('Lancer la campagne maintenant ? Les jobs seront créés dans la file du Sender.');">🚀 Lancer maintenant</button>
                    </form>
                </div>
            <?php endif; ?>
        </div>
        <?php
    }
    // __BC_DETAIL_END__

    /**
     * Templates & Civilités — bibliothèque centrale des messages réutilisables.
     * Source de vérité UNIQUE : table {prefix}digiware_whatsapp_templates (la même que
     * lisent déjà les Campagnes via bc_templates_available()). Aucun second système.
     * Dispatcher : ?taction = list (défaut) | new | edit&tid=...
     */
    private static function render_templates_tab() {
        self::tpl_ensure_schema();
        $action = isset($_GET['taction']) ? sanitize_key($_GET['taction']) : 'list';
        if ($action === 'new' || $action === 'edit') {
            self::render_template_form($action === 'edit' ? sanitize_text_field(wp_unslash(isset($_GET['tid']) ? $_GET['tid'] : '')) : '');
            return;
        }
        self::render_templates_list();
    }
    /** Table réelle des templates (partagée avec les Campagnes et l'API REST). */
    private static function tpl_table() {
        global $wpdb;
        return $wpdb->prefix . 'digiware_whatsapp_templates';
    }

    /**
     * Schéma idempotent. Crée la table si l'installeur ne l'a pas fait, puis AJOUTE les
     * colonnes de gestion (type/status/updated_at) sans casser les colonnes existantes
     * ni les consommateurs actuels (bc_templates_available lit template_id/name/content).
     */
    private static function tpl_ensure_schema() {
        global $wpdb;
        static $done = false;
        if ($done) { return; }
        $done = true;
        $t = self::tpl_table();
        if ($wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $t)) !== $t) {
            $charset = $wpdb->get_charset_collate();
            require_once ABSPATH . 'wp-admin/includes/upgrade.php';
            dbDelta("CREATE TABLE {$t} (
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
            ) {$charset};");
        }
        // Colonnes de gestion ajoutées à la table réelle (pas de table parallèle).
        if (!$wpdb->get_var($wpdb->prepare("SHOW COLUMNS FROM {$t} LIKE %s", 'type'))) {
            $wpdb->query("ALTER TABLE {$t} ADD COLUMN type VARCHAR(32) NOT NULL DEFAULT 'standard' AFTER category");
        }
        if (!$wpdb->get_var($wpdb->prepare("SHOW COLUMNS FROM {$t} LIKE %s", 'status'))) {
            $wpdb->query("ALTER TABLE {$t} ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'draft' AFTER type");
        }
        if (!$wpdb->get_var($wpdb->prepare("SHOW COLUMNS FROM {$t} LIKE %s", 'updated_at'))) {
            $wpdb->query("ALTER TABLE {$t} ADD COLUMN updated_at DATETIME DEFAULT NULL AFTER created_at");
        }
    }

    /** Catégories = mêmes valeurs que les Campagnes (bc_types), pas de doublon de vocabulaire. */
    private static function tpl_categories() {
        return self::bc_types();
    }

    /** Types de format réellement gérés par le moteur d'envoi partagé. */
    private static function tpl_types() {
        return array(
            'standard' => 'Texte simple',
            'spintax'  => 'Variantes (Spintax)',
            'lien'     => 'Avec lien / CTA',
        );
    }

    /** Statuts de template : Brouillon / Actif / Archivé (badge réutilisé du reste du BC). */
    private static function tpl_status_defs() {
        return array(
            'draft'    => array('Brouillon', 'dw-st-prospect'),
            'active'   => array('Actif',     'dw-st-actif'),
            'archived' => array('Archivé',   'dw-st-optout'),
        );
    }

    /**
     * Variables RÉELLEMENT résolues bout-en-bout : bc_normalize_tokens -> moteur du Sender
     * (WASenderEngine::interpolateVariables). On n'expose QUE ce que le pipeline sait résoudre.
     */
    private static function tpl_variables() {
        return array(
            '{{prenom}}'     => 'Prénom (CRM)',
            '{{nom}}'        => 'Nom (CRM)',
            '{{telephone}}'  => 'Téléphone (CRM)',
            '{{entreprise}}' => 'Entreprise (CRM)',
            '{{ville}}'      => 'Ville (CRM)',
            '{{profession}}' => 'Profession (CRM)',
            '{{specialite}}' => 'Spécialité (CRM)',
            '{{civilite}}'   => 'Civilité (donnée explicite du contact)',
        );
    }

    /**
     * Jetons connus pour la validation (avertissement non bloquant si inconnu).
     * = variables résolues par le moteur + jetons injectés en aval (lien/commande).
     */
    private static function tpl_known_tokens() {
        return array('prenom','nom','telephone','tel','entreprise','ville','profession',
            'specialite','civilite','first_name','last_name','company','city',
            'link','tracking_link','order_id');
    }

    /** Liste administrable des civilités (persistée en option WP réelle). */
    private static function tpl_civilites() {
        $opt = get_option('dw_wa_civilites', null);
        if (!is_array($opt) || empty($opt)) {
            return array('Monsieur', 'Madame', 'Maître', 'Docteur');
        }
        return array_values(array_filter(array_map('trim', $opt)));
    }

    /** Lit toutes les définitions de templates (filtres optionnels). */
    private static function tpl_list($filters = array()) {
        self::tpl_ensure_schema();
        global $wpdb;
        $t = self::tpl_table();
        $rows = $wpdb->get_results("SELECT * FROM {$t} ORDER BY (updated_at IS NULL), updated_at DESC, id DESC", ARRAY_A);
        $rows = is_array($rows) ? $rows : array();
        $cat = isset($filters['category']) ? $filters['category'] : '';
        $typ = isset($filters['type']) ? $filters['type'] : '';
        $sta = isset($filters['status']) ? $filters['status'] : '';
        $q   = isset($filters['q']) ? mb_strtolower(trim($filters['q'])) : '';
        return array_values(array_filter($rows, function ($r) use ($cat, $typ, $sta, $q) {
            if ($cat !== '' && $r['category'] !== $cat) { return false; }
            if ($typ !== '' && (isset($r['type']) ? $r['type'] : '') !== $typ) { return false; }
            if ($sta !== '' && (isset($r['status']) ? $r['status'] : '') !== $sta) { return false; }
            if ($q !== '') {
                $hay = mb_strtolower($r['name'] . ' ' . $r['content']);
                if (mb_strpos($hay, $q) === false) { return false; }
            }
            return true;
        }));
    }

    /** Charge une définition par template_id. */
    private static function tpl_get($template_id) {
        self::tpl_ensure_schema();
        global $wpdb;
        $t = self::tpl_table();
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE template_id = %s", $template_id), ARRAY_A);
    }
    /** Détecte les variables {{...}} inconnues dans un contenu. Retourne la liste des jetons. */
    private static function tpl_unknown_vars($content) {
        $known = self::tpl_known_tokens();
        $out = array();
        if (preg_match_all('/\{\{\s*([a-z0-9_]+)\s*\}\}/i', (string) $content, $m)) {
            foreach ($m[1] as $tok) {
                $tok = strtolower($tok);
                if (!in_array($tok, $known, true) && !in_array($tok, $out, true)) { $out[] = $tok; }
            }
        }
        return $out;
    }

    /**
     * Résout un template pour un contact CRM RÉEL via EXACTEMENT le pipeline d'envoi :
     * bc_normalize_tokens ({{x}} -> {x}) puis WASenderEngine::processOutreachMessage.
     * Garantit que l'aperçu == le message qui partira réellement.
     */
    private static function tpl_resolve_for_contact($content, $contact_id) {
        $meta = array();
        $phone = '';
        foreach (self::crm_collect_contacts() as $row) {
            if ($row['contact_id'] === $contact_id) {
                $rec = self::crm_get_record($contact_id);
                $civ = ($rec && !empty($rec['civility'])) ? $rec['civility'] : '';
                $meta = self::bc_meta_from_row(array(
                    'contact_id' => $row['contact_id'], 'norm' => $row['norm'], 'name' => $row['name'],
                    'company' => $row['company'], 'city' => $row['city'], 'profession' => $row['profession'],
                    'civility' => $civ,
                ));
                $phone = $meta['phone'];
                break;
            }
        }
        $normalized = self::bc_normalize_tokens($content);
        if (class_exists('\\DigiWare\\WhatsApp\\Sender\\WASenderEngine')) {
            return \DigiWare\WhatsApp\Sender\WASenderEngine::processOutreachMessage($normalized, $meta, $phone);
        }
        return $normalized;
    }

    /** AJAX : aperçu personnalisé RÉEL. Renvoie le message final + variables non résolues. */
    public static function ajax_tpl_preview() {
        if (!current_user_can('manage_options')) { wp_send_json_error('forbidden', 403); }
        check_ajax_referer('dw_tpl_ajax', 'nonce');
        $content = isset($_POST['content']) ? wp_unslash($_POST['content']) : '';
        $cid     = isset($_POST['contact_id']) ? sanitize_text_field(wp_unslash($_POST['contact_id'])) : '';
        $final   = self::tpl_resolve_for_contact($content, $cid);
        $leftover = array();
        if (preg_match_all('/\{[a-z0-9_]+\}/i', $final, $m)) { $leftover = array_values(array_unique($m[0])); }
        wp_send_json_success(array(
            'final'    => $final,
            'unknown'  => self::tpl_unknown_vars($content),
            'leftover' => $leftover,
        ));
    }

    /** Aiguilleur des actions POST Templates (nonce + capability déjà vérifiés en amont). */
    private static function tpl_handle_actions($action) {
        self::tpl_ensure_schema();
        global $wpdb;
        $t = self::tpl_table();
        $flash = 'saved';

        if ($action === 'tpl_civilites_save') {
            $raw = isset($_POST['civilites']) ? wp_unslash($_POST['civilites']) : '';
            $list = array_values(array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $raw))));
            update_option('dw_wa_civilites', $list);
            self::tpl_redirect('civilites');
        }

        if ($action === 'tpl_delete') {
            $tid = sanitize_text_field(wp_unslash($_POST['tid']));
            $wpdb->delete($t, array('template_id' => $tid));
            self::tpl_redirect('deleted');
        }

        if ($action === 'tpl_duplicate') {
            $tid = sanitize_text_field(wp_unslash($_POST['tid']));
            $src = self::tpl_get($tid);
            if ($src) {
                $now = current_time('mysql');
                $wpdb->insert($t, array(
                    'template_id' => 'tpl_' . substr(md5(uniqid('', true)), 0, 12),
                    'name'        => mb_substr($src['name'] . ' (copie)', 0, 128),
                    'category'    => $src['category'],
                    'type'        => isset($src['type']) ? $src['type'] : 'standard',
                    'status'      => 'draft',
                    'description' => isset($src['description']) ? $src['description'] : '',
                    'content'     => $src['content'],
                    'created_at'  => $now,
                    'updated_at'  => $now,
                ));
            }
            self::tpl_redirect('duplicated');
        }

        if ($action === 'tpl_status') {
            $tid = sanitize_text_field(wp_unslash($_POST['tid']));
            $new = sanitize_key($_POST['status']);
            $defs = self::tpl_status_defs();
            if (isset($defs[$new])) {
                $wpdb->update($t, array('status' => $new, 'updated_at' => current_time('mysql')), array('template_id' => $tid));
            }
            self::tpl_redirect($new === 'archived' ? 'archived' : 'saved');
        }

        // tpl_save : création ou mise à jour.
        $tid    = sanitize_text_field(wp_unslash(isset($_POST['tid']) ? $_POST['tid'] : ''));
        $name   = sanitize_text_field(wp_unslash(isset($_POST['name']) ? $_POST['name'] : ''));
        $cat    = sanitize_key(isset($_POST['category']) ? $_POST['category'] : '');
        $type   = sanitize_key(isset($_POST['type']) ? $_POST['type'] : 'standard');
        $status = sanitize_key(isset($_POST['status']) ? $_POST['status'] : 'draft');
        $content = wp_unslash(isset($_POST['content']) ? $_POST['content'] : '');

        // Validation minimale (n'invente rien, ne bloque pas au-delà du nécessaire).
        $cats = self::tpl_categories();
        $types = self::tpl_types();
        $sdefs = self::tpl_status_defs();
        if (!isset($cats[$cat]))     { $cat = 'marketing'; }
        if (!isset($types[$type]))   { $type = 'standard'; }
        if (!isset($sdefs[$status])) { $status = 'draft'; }
        if ($name === '' || trim($content) === '') {
            self::tpl_redirect('invalid', $tid);
        }

        $now = current_time('mysql');
        if ($tid !== '' && self::tpl_get($tid)) {
            $wpdb->update($t, array(
                'name' => mb_substr($name, 0, 128), 'category' => $cat, 'type' => $type,
                'status' => $status, 'content' => $content, 'updated_at' => $now,
            ), array('template_id' => $tid));
        } else {
            $tid = 'tpl_' . substr(md5(uniqid('', true)), 0, 12);
            $wpdb->insert($t, array(
                'template_id' => $tid, 'name' => mb_substr($name, 0, 128), 'category' => $cat,
                'type' => $type, 'status' => $status, 'description' => '', 'content' => $content,
                'created_at' => $now, 'updated_at' => $now,
            ));
        }
        $flash = self::tpl_unknown_vars($content) ? 'saved_warn' : 'saved';
        self::tpl_redirect($flash);
    }

    /** Redirection avec message flash vers la liste Templates. */
    private static function tpl_redirect($flash, $tid = '') {
        $args = array('page' => 'digiware-whatsapp', 'tab' => 'templates', 'tpl' => $flash);
        if ($flash === 'invalid' && $tid !== '') { $args['taction'] = 'edit'; $args['tid'] = $tid; }
        wp_redirect(add_query_arg($args, admin_url('admin.php')));
        exit;
    }
    /** VUE 1 — Liste des templates + recherche/filtres + panneau Civilités. */
    private static function render_templates_list() {
        $cats  = self::tpl_categories();
        $types = self::tpl_types();
        $sdefs = self::tpl_status_defs();
        $f = array(
            'q'        => isset($_GET['q']) ? sanitize_text_field(wp_unslash($_GET['q'])) : '',
            'category' => isset($_GET['fcat']) ? sanitize_key($_GET['fcat']) : '',
            'type'     => isset($_GET['ftype']) ? sanitize_key($_GET['ftype']) : '',
            'status'   => isset($_GET['fstatus']) ? sanitize_key($_GET['fstatus']) : '',
        );
        $rows = self::tpl_list($f);
        $base = admin_url('admin.php?page=digiware-whatsapp&tab=templates');
        $flash = isset($_GET['tpl']) ? sanitize_key($_GET['tpl']) : '';
        $notices = array(
            'saved'      => array('ok',   'Template enregistré.'),
            'saved_warn' => array('warn', 'Template enregistré — attention : une ou plusieurs variables ne sont pas reconnues par le moteur (voir l\'éditeur).'),
            'deleted'    => array('ok',   'Template supprimé.'),
            'duplicated' => array('ok',   'Template dupliqué (nouveau brouillon).'),
            'archived'   => array('ok',   'Template archivé — il ne sera plus proposé comme nouveau dans les Campagnes.'),
            'civilites'  => array('ok',   'Liste des civilités enregistrée.'),
            'invalid'    => array('err',  'Enregistrement refusé : le nom et le contenu du message sont obligatoires.'),
        );
        ?>
        <?php if (isset($notices[$flash])):
            $col = array('ok' => array('#dcfce7', '#166534', '#86efac'), 'warn' => array('#fef9c3', '#854d0e', '#fde047'), 'err' => array('#fee2e2', '#991b1b', '#fca5a5'));
            $c = $col[$notices[$flash][0]]; ?>
            <div style="background: <?php echo $c[0]; ?>; color: <?php echo $c[1]; ?>; border: 1px solid <?php echo $c[2]; ?>; border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; font-weight: 600;">
                <?php echo esc_html($notices[$flash][1]); ?>
            </div>
        <?php endif; ?>

        <div class="dw-card" style="margin-bottom: 16px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
                <div>
                    <h2 style="margin: 0 0 4px; font-size: 18px; font-weight: 800;">Templates &amp; Civilités</h2>
                    <p style="margin: 0; font-size: 13px; color: #64748b;">Bibliothèque centrale des messages réutilisables. Les Campagnes sélectionnent un template ; les variables sont résolues avec les données du CRM avant l'envoi.</p>
                </div>
                <a href="<?php echo esc_url($base . '&taction=new'); ?>" class="button button-primary" style="height: 36px; display: inline-flex; align-items: center;">+ Nouveau template</a>
            </div>
            <form method="get" style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                <input type="hidden" name="page" value="digiware-whatsapp" />
                <input type="hidden" name="tab" value="templates" />
                <input type="search" name="q" value="<?php echo esc_attr($f['q']); ?>" placeholder="Rechercher un template…" style="min-width: 220px; height: 34px;" />
                <select name="fcat" style="height: 34px;"><option value="">Toutes catégories</option>
                    <?php foreach ($cats as $k => $lbl): ?><option value="<?php echo esc_attr($k); ?>" <?php selected($f['category'], $k); ?>><?php echo esc_html($lbl); ?></option><?php endforeach; ?>
                </select>
                <select name="ftype" style="height: 34px;"><option value="">Tous types</option>
                    <?php foreach ($types as $k => $lbl): ?><option value="<?php echo esc_attr($k); ?>" <?php selected($f['type'], $k); ?>><?php echo esc_html($lbl); ?></option><?php endforeach; ?>
                </select>
                <select name="fstatus" style="height: 34px;"><option value="">Tous statuts</option>
                    <?php foreach ($sdefs as $k => $d): ?><option value="<?php echo esc_attr($k); ?>" <?php selected($f['status'], $k); ?>><?php echo esc_html($d[0]); ?></option><?php endforeach; ?>
                </select>
                <button type="submit" class="button">Filtrer</button>
                <?php if ($f['q'] || $f['category'] || $f['type'] || $f['status']): ?><a href="<?php echo esc_url($base); ?>" class="button-link" style="font-size: 12px;">Réinitialiser</a><?php endif; ?>
            </form>
        </div>

        <div class="dw-card">
            <table class="dw-table">
                <thead><tr>
                    <th>Nom</th><th>Catégorie</th><th>Type</th><th>Statut</th><th>Dernière modification</th><th style="text-align: right;">Actions</th>
                </tr></thead>
                <tbody>
                <?php if (empty($rows)): ?>
                    <tr><td colspan="6" style="text-align: center; padding: 40px 16px; color: #94a3b8;">
                        <?php echo (self::tpl_list(array()) ? 'Aucun template ne correspond aux filtres.' : 'Aucun template enregistré. Cliquez sur « + Nouveau template » pour créer votre premier message réutilisable.'); ?>
                    </td></tr>
                <?php else: foreach ($rows as $r):
                    $sd = isset($sdefs[$r['status']]) ? $sdefs[$r['status']] : array(ucfirst($r['status']), 'dw-st-prospect');
                    $edit = esc_url($base . '&taction=edit&tid=' . rawurlencode($r['template_id']));
                    $mod = !empty($r['updated_at']) ? $r['updated_at'] : (isset($r['created_at']) ? $r['created_at'] : ''); ?>
                    <tr>
                        <td><strong><?php echo esc_html($r['name']); ?></strong><div style="font-size: 11px; color: #94a3b8;"><?php echo esc_html($r['template_id']); ?></div></td>
                        <td><?php echo esc_html(isset($cats[$r['category']]) ? $cats[$r['category']] : $r['category']); ?></td>
                        <td><?php echo esc_html(isset($types[$r['type']]) ? $types[$r['type']] : (isset($r['type']) ? $r['type'] : '—')); ?></td>
                        <td><span class="dw-badge <?php echo esc_attr($sd[1]); ?>"><?php echo esc_html($sd[0]); ?></span></td>
                        <td style="font-size: 12px; color: #64748b;"><?php echo esc_html($mod ? mysql2date('d/m/Y H:i', $mod) : '—'); ?></td>
                        <td style="text-align: right; white-space: nowrap;">
                            <a href="<?php echo $edit; ?>" class="button button-small">Modifier</a>
                            <form method="post" style="display: inline;"><?php wp_nonce_field('dw_wa_action_nonce'); ?>
                                <input type="hidden" name="dw_wa_action" value="tpl_duplicate" /><input type="hidden" name="tid" value="<?php echo esc_attr($r['template_id']); ?>" />
                                <button type="submit" class="button button-small">Dupliquer</button>
                            </form>
                            <?php if ($r['status'] !== 'archived'): ?>
                            <a href="<?php echo esc_url(admin_url('admin.php?page=digiware-whatsapp&tab=campaigns&action=new')); ?>" class="button button-small" title="Ce template est disponible dans le sélecteur de l'assistant de campagne">Utiliser</a>
                            <?php endif; ?>
                            <form method="post" style="display: inline;" onsubmit="return confirm('Supprimer définitivement ce template ?');"><?php wp_nonce_field('dw_wa_action_nonce'); ?>
                                <input type="hidden" name="dw_wa_action" value="tpl_delete" /><input type="hidden" name="tid" value="<?php echo esc_attr($r['template_id']); ?>" />
                                <button type="submit" class="button button-small" style="color: #b91c1c;">Supprimer</button>
                            </form>
                        </td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>

        <?php self::render_civilites_panel(); ?>
        <?php
    }
    /** Panneau Civilités administrable — persistance RÉELLE via l'option dw_wa_civilites. */
    private static function render_civilites_panel() {
        $civ = self::tpl_civilites();
        ?>
        <div class="dw-card" style="margin-top: 16px;">
            <h2 style="margin: 0 0 4px; font-size: 16px; font-weight: 800;">Civilités</h2>
            <p style="margin: 0 0 12px; font-size: 13px; color: #64748b;">
                Liste de référence pour la variable <code>{{civilite}}</code>. La civilité provient d'une donnée <strong>explicitement enregistrée</strong> sur chaque contact (fiche CRM) — elle n'est <strong>jamais déduite</strong> du prénom. Un contact sans civilité laisse la variable vide.
            </p>
            <form method="post" style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start;">
                <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                <input type="hidden" name="dw_wa_action" value="tpl_civilites_save" />
                <div>
                    <label style="display: block; font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 4px;">Civilités (une par ligne)</label>
                    <textarea name="civilites" rows="5" style="width: 260px; font-family: monospace; font-size: 13px;"><?php echo esc_textarea(implode("\n", $civ)); ?></textarea>
                </div>
                <div style="flex: 1; min-width: 200px;">
                    <div style="font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 6px;">Aperçu</div>
                    <div class="dw-chip-row">
                        <?php foreach ($civ as $c): ?><span class="dw-badge dw-st-prospect"><?php echo esc_html($c); ?></span><?php endforeach; ?>
                    </div>
                    <button type="submit" class="button button-primary" style="margin-top: 14px;">Enregistrer les civilités</button>
                </div>
            </form>
        </div>
        <?php
    }

    /** VUES 2 & 3 — Création / Modification d'un template. */
    private static function render_template_form($tid) {
        $cats  = self::tpl_categories();
        $types = self::tpl_types();
        $sdefs = self::tpl_status_defs();
        $vars  = self::tpl_variables();
        $civ   = self::tpl_civilites();
        $row = $tid !== '' ? self::tpl_get($tid) : null;
        $cur = array(
            'template_id' => $row ? $row['template_id'] : '',
            'name'        => $row ? $row['name'] : '',
            'category'    => $row ? $row['category'] : 'marketing',
            'type'        => $row && isset($row['type']) ? $row['type'] : 'standard',
            'status'      => $row && isset($row['status']) ? $row['status'] : 'draft',
            'content'     => $row ? $row['content'] : '',
        );
        $base = admin_url('admin.php?page=digiware-whatsapp&tab=templates');
        // Contacts réels pour l'aperçu (aucun faux contact de démonstration).
        $contacts = array();
        foreach (self::crm_collect_contacts() as $c) {
            $contacts[] = array('id' => $c['contact_id'], 'label' => ($c['name'] !== '' ? $c['name'] : $c['display']) . ' — ' . $c['display']);
        }
        ?>
        <div class="dw-card">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                <h2 style="margin: 0; font-size: 18px; font-weight: 800;"><?php echo $row ? 'Modifier le template' : 'Nouveau template'; ?></h2>
                <a href="<?php echo esc_url($base); ?>" class="button">← Retour à la liste</a>
            </div>
            <form method="post" id="dw-tpl-form">
                <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                <input type="hidden" name="dw_wa_action" value="tpl_save" />
                <input type="hidden" name="tid" value="<?php echo esc_attr($cur['template_id']); ?>" />
                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 12px; margin: 16px 0;">
                    <div><label style="font-size:12px;font-weight:700;color:#475569;">Nom interne *</label>
                        <input type="text" name="name" value="<?php echo esc_attr($cur['name']); ?>" required style="width:100%;height:34px;" /></div>
                    <div><label style="font-size:12px;font-weight:700;color:#475569;">Catégorie</label>
                        <select name="category" style="width:100%;height:34px;"><?php foreach ($cats as $k => $l): ?><option value="<?php echo esc_attr($k); ?>" <?php selected($cur['category'], $k); ?>><?php echo esc_html($l); ?></option><?php endforeach; ?></select></div>
                    <div><label style="font-size:12px;font-weight:700;color:#475569;">Type</label>
                        <select name="type" style="width:100%;height:34px;"><?php foreach ($types as $k => $l): ?><option value="<?php echo esc_attr($k); ?>" <?php selected($cur['type'], $k); ?>><?php echo esc_html($l); ?></option><?php endforeach; ?></select></div>
                    <div><label style="font-size:12px;font-weight:700;color:#475569;">Statut</label>
                        <select name="status" style="width:100%;height:34px;"><?php foreach ($sdefs as $k => $d): ?><option value="<?php echo esc_attr($k); ?>" <?php selected($cur['status'], $k); ?>><?php echo esc_html($d[0]); ?></option><?php endforeach; ?></select></div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 320px; gap: 20px;">
                    <div>
                        <label style="font-size:12px;font-weight:700;color:#475569;">Message *</label>
                        <textarea name="content" id="dw-tpl-content" rows="10" required style="width:100%;font-size:14px;line-height:1.5;font-family:inherit;" placeholder="Bonjour {{civilite}} {{prenom}}, ..."><?php echo esc_textarea($cur['content']); ?></textarea>
                        <div id="dw-tpl-warn" style="display:none;margin-top:8px;background:#fef9c3;color:#854d0e;border:1px solid #fde047;border-radius:8px;padding:8px 12px;font-size:12px;"></div>
                        <div style="margin-top:6px;font-size:11px;color:#94a3b8;">Le moteur d'envoi gère aussi le Spintax : <code>{Bonjour|Salut}</code>.</div>
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:700;color:#475569;">Variables disponibles</label>
                        <div class="dw-chip-row" style="margin:6px 0 4px;">
                            <?php foreach ($vars as $token => $desc): ?>
                            <button type="button" class="button button-small dw-tpl-var" data-token="<?php echo esc_attr($token); ?>" title="<?php echo esc_attr($desc); ?>" style="margin:0 4px 4px 0;font-family:monospace;"><?php echo esc_html($token); ?></button>
                            <?php endforeach; ?>
                        </div>
                        <p style="font-size:11px;color:#94a3b8;margin:0 0 14px;">Ces variables sont résolues avec les données réelles du CRM avant l'envoi. Les données commande/produit (<code>{{produit}}</code>, <code>{{montant}}</code>…) ne sont pas encore résolues par le moteur d'envoi et ne sont donc pas proposées.</p>

                        <label style="font-size:12px;font-weight:700;color:#475569;">Civilités de référence</label>
                        <div class="dw-chip-row" style="margin:6px 0 14px;"><?php foreach ($civ as $c): ?><span class="dw-badge dw-st-prospect"><?php echo esc_html($c); ?></span><?php endforeach; ?></div>

                        <label style="font-size:12px;font-weight:700;color:#475569;">Aperçu avec un contact réel</label>
                        <select id="dw-tpl-contact" style="width:100%;height:34px;margin:6px 0;">
                            <option value="">— Sélectionner un contact —</option>
                            <?php foreach ($contacts as $c): ?><option value="<?php echo esc_attr($c['id']); ?>"><?php echo esc_html($c['label']); ?></option><?php endforeach; ?>
                        </select>
                        <?php if (empty($contacts)): ?><p style="font-size:11px;color:#94a3b8;margin:0 0 8px;">Aucun contact réel disponible pour l'aperçu.</p><?php endif; ?>
                        <div id="dw-tpl-preview" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;font-size:13px;color:#334155;white-space:pre-wrap;min-height:60px;">L'aperçu du message final apparaîtra ici.</div>
                    </div>
                </div>

                <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                    <a href="<?php echo esc_url($base); ?>" class="button">Annuler</a>
                    <button type="submit" class="button button-primary">Enregistrer</button>
                </div>
            </form>
        </div>
        <?php self::render_template_form_js(); ?>
        <?php
    }
    /** JS de l'éditeur : insertion des variables, avertissement live, aperçu AJAX réel. */
    private static function render_template_form_js() {
        $nonce = wp_create_nonce('dw_tpl_ajax');
        $known = wp_json_encode(self::tpl_known_tokens());
        ?>
        <script>
        (function(){
            var ta = document.getElementById('dw-tpl-content');
            var warn = document.getElementById('dw-tpl-warn');
            var sel = document.getElementById('dw-tpl-contact');
            var out = document.getElementById('dw-tpl-preview');
            var known = <?php echo $known; ?>;
            if (!ta) { return; }

            document.querySelectorAll('.dw-tpl-var').forEach(function(btn){
                btn.addEventListener('click', function(){
                    var tok = btn.getAttribute('data-token');
                    var s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
                    ta.value = ta.value.slice(0, s) + tok + ta.value.slice(e);
                    ta.focus(); ta.selectionStart = ta.selectionEnd = s + tok.length;
                    checkVars(); refresh();
                });
            });

            function checkVars(){
                var m = ta.value.match(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi) || [];
                var bad = [];
                m.forEach(function(t){
                    var k = t.replace(/[{}\s]/g,'').toLowerCase();
                    if (known.indexOf(k) === -1 && bad.indexOf(k) === -1) { bad.push(k); }
                });
                if (bad.length) {
                    warn.style.display = 'block';
                    warn.textContent = 'Variable(s) non reconnue(s) par le moteur : ' + bad.map(function(x){return '{{'+x+'}}';}).join(', ') + '. Elle(s) ne seront pas remplacée(s) à l\'envoi.';
                } else { warn.style.display = 'none'; }
            }

            var timer = null;
            function refresh(){
                var cid = sel ? sel.value : '';
                if (!cid) { out.textContent = 'Sélectionnez un contact réel pour voir le message final.'; return; }
                out.textContent = 'Résolution…';
                var body = new URLSearchParams();
                body.append('action', 'dw_tpl_preview');
                body.append('nonce', '<?php echo esc_js($nonce); ?>');
                body.append('content', ta.value);
                body.append('contact_id', cid);
                fetch(ajaxurl, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: body.toString()})
                  .then(function(r){return r.json();})
                  .then(function(j){
                      if (j && j.success) {
                          out.textContent = j.data.final || '(message vide)';
                          if (j.data.leftover && j.data.leftover.length) {
                              out.textContent += '\n\n⚠ Non résolu : ' + j.data.leftover.join(', ');
                          }
                      } else { out.textContent = 'Aperçu indisponible.'; }
                  })
                  .catch(function(){ out.textContent = 'Erreur lors de l\'aperçu.'; });
            }

            ta.addEventListener('input', function(){ checkVars(); clearTimeout(timer); timer = setTimeout(refresh, 400); });
            if (sel) { sel.addEventListener('change', refresh); }
            checkVars();
        })();
        </script>
        <?php
    }

    private static function render_catalog_tab() {
        $products = array();
        if (function_exists('wc_get_products')) {
            $wc = wc_get_products(array('status' => 'publish', 'limit' => 50, 'orderby' => 'date', 'order' => 'DESC'));
            foreach ($wc as $p) {
                $products[] = array(
                    'name'  => $p->get_name(),
                    'price' => $p->get_price_html(),
                    'stock' => $p->is_in_stock() ? ($p->get_stock_quantity() !== null ? (int) $p->get_stock_quantity() . ' en stock' : 'Disponible') : 'Rupture',
                    'instock' => $p->is_in_stock(),
                );
            }
        }
        ?>
        <div class="dw-card">
            <h2 style="margin-top: 0; font-size: 18px; font-weight: 800;">Catalogue WooCommerce &amp; Arguments Commerciaux</h2>
            <p style="font-size: 13px; color: #64748b;">
                Couche commerciale connectée au catalogue WooCommerce pour alimenter les conversations et l'Agent IA.
            </p>
            <table class="dw-table">
                <thead>
                    <tr>
                        <th>Produit</th>
                        <th>Prix Réel</th>
                        <th>Stock Réel</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($products)): ?>
                    <tr>
                        <td colspan="3" style="text-align: center; padding: 40px 16px; color: #94a3b8;">
                            <?php echo function_exists('wc_get_products')
                                ? 'Aucun produit publié dans WooCommerce.'
                                : 'WooCommerce n\'est pas actif. Activez WooCommerce pour afficher le catalogue réel.'; ?>
                        </td>
                    </tr>
                    <?php else: foreach ($products as $p): ?>
                    <tr>
                        <td><strong><?php echo esc_html($p['name']); ?></strong></td>
                        <td><?php echo wp_kses_post($p['price']); ?></td>
                        <td><span style="color: <?php echo $p['instock'] ? '#059669' : '#dc2626'; ?>; font-weight: 700;"><?php echo esc_html($p['stock']); ?></span></td>
                    </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    private static function render_links_tab() {
        ?>
        <div class="dw-card">
            <h2 style="margin-top: 0; font-size: 18px; font-weight: 800;">Link Center (Attribution, UTMs, Shortener &amp; OmniTracker)</h2>
            <p style="font-size: 13px; color: #64748b;">
                Orchestration complète des liens pour WhatsApp : Shortener, paramètres UTM stricts et enregistrement du contexte dans OmniTracker avant l'envoi.
            </p>
            <table class="dw-table">
                <thead>
                    <tr>
                        <th>Link ID</th>
                        <th>Destination</th>
                        <th>Campagne & Segment</th>
                        <th>Paramètres UTM</th>
                        <th>Clics Réels</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 40px 16px; color: #94a3b8;">
                            Aucun lien suivi pour le moment. Les liens générés pour vos campagnes apparaîtront ici avec leurs clics OmniTracker réels.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <?php
    }

    private static function render_ai_agent_tab() {
        ?>
        <div class="dw-card">
            <h2 style="margin-top: 0; font-size: 18px; font-weight: 800;">AI Agent Commercial</h2>
            <p style="font-size: 13px; color: #64748b;">
                Configuration de l'assistant commercial connecté aux données vérifiées de votre site et de WooCommerce.
            </p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
                    <h3 style="margin-top: 0; font-size: 15px;">Mode de Fonctionnement</h3>
                    <div style="margin-bottom: 12px;">
                        <label><input type="radio" name="ai_mode" value="off" /> <strong>Désactivé</strong></label>
                    </div>
                    <div style="margin-bottom: 12px;">
                        <label><input type="radio" name="ai_mode" value="suggestion" checked /> <strong>Mode Suggestion</strong> (L'IA prépare la réponse, l'opérateur valide)</label>
                    </div>
                    <div>
                        <label><input type="radio" name="ai_mode" value="auto" /> <strong>Mode Automatique</strong> (Dans les limites strictes des règles)</label>
                    </div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
                    <h3 style="margin-top: 0; font-size: 15px;">Règles Métier & Transfert Humain</h3>
                    <ul style="font-size: 13px; color: #475569; margin: 0; padding-left: 20px;">
                        <li>L'Agent ne doit jamais inventer un prix ou un stock.</li>
                        <li>Transfert immédiat si le client demande un devis spécifique ou un appel.</li>
                        <li>Horaires d'activité configurés : Lun-Ven 08h30 - 18h30.</li>
                    </ul>
                </div>
            </div>
        </div>
        <?php
    }

    private static function render_analytics_tab() {
        $sc = array();
        if (class_exists('\\DigiWare\\WhatsApp\\Sender\\WASenderQueue')) {
            $sc = \DigiWare\WhatsApp\Sender\WASenderQueue::get_status_counts();
        }
        $total     = (int) ($sc['total'] ?? 0);
        $sent      = (int) ($sc['sent'] ?? 0) + (int) ($sc['delivered'] ?? 0) + (int) ($sc['read'] ?? 0);
        $replies   = (int) ($sc['replies_count'] ?? 0);
        $failed    = (int) ($sc['failed'] ?? 0);
        ?>
        <div class="dw-card">
            <h2 style="margin-top: 0; font-size: 18px; font-weight: 800;">Analytics &amp; Performance Métier</h2>
            <p style="font-size: 13px; color: #64748b;">
                Métriques réelles basées sur la chaîne complète : Job créé ≠ Message envoyé ≠ Clic OmniTracker ≠ Commande.
            </p>
            <div class="dw-stats-grid">
                <div class="dw-stat-box">
                    <div class="dw-stat-label">Jobs Transmis au Sender</div>
                    <div class="dw-stat-num"><?php echo $total; ?></div>
                </div>
                <div class="dw-stat-box">
                    <div class="dw-stat-label">Envois Confirmés (✓✓)</div>
                    <div class="dw-stat-num" style="color: #059669;"><?php echo $sent; ?></div>
                </div>
                <div class="dw-stat-box">
                    <div class="dw-stat-label">Réponses Reçues</div>
                    <div class="dw-stat-num" style="color: #0284c7;"><?php echo $replies; ?></div>
                </div>
                <div class="dw-stat-box">
                    <div class="dw-stat-label">Échecs / Non délivrés</div>
                    <div class="dw-stat-num" style="color: #dc2626;"><?php echo $failed; ?></div>
                </div>
            </div>
        </div>
        <?php
    }

    private static function render_activity_tab() {
        global $wpdb;
        $jobs_table    = $wpdb->prefix . 'wasender_jobs';
        $events = $wpdb->get_results(
            "SELECT id, created_at, phone, metadata, status FROM {$jobs_table} ORDER BY created_at DESC LIMIT 100",
            ARRAY_A
        );
        $status_labels = array(
            'queued'           => array('En file', '#64748b'),
            'processing'       => array('En cours', '#0284c7'),
            'sent'             => array('✓ Envoyé', '#059669'),
            'delivered'        => array('✓✓ Délivré', '#059669'),
            'read'             => array('✓✓ Lu', '#0284c7'),
            'failed'           => array('✗ Échec', '#dc2626'),
            'held_undelivered' => array('✗ Non délivré', '#dc2626'),
            'opted_out'        => array('Opt-out', '#92400e'),
        );
        ?>
        <div class="dw-card">
            <h2 style="margin-top: 0; font-size: 18px; font-weight: 800;">Journal &amp; Traçabilité Immuable</h2>
            <p style="font-size: 13px; color: #64748b;">
                Chaîne complète : <code>contact_id</code> → <code>conversation_id</code> → <code>campaign_id</code> → <code>segment_id</code> → <code>template_id</code> → <code>link_id</code> → <code>job_id</code> → <code>OmniTracker</code>.
            </p>
            <table class="dw-table">
                <thead>
                    <tr>
                        <th>Horodatage</th>
                        <th>Téléphone</th>
                        <th>Job Token</th>
                        <th>Statut</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($events)): ?>
                    <tr>
                        <td colspan="4" style="text-align: center; padding: 40px 16px; color: #94a3b8;">
                            Aucun événement enregistré. Le journal se remplira au fil des envois et des réponses.
                        </td>
                    </tr>
                    <?php else: foreach ($events as $e):
                        $lbl = isset($status_labels[$e['status']]) ? $status_labels[$e['status']] : array($e['status'], '#64748b');
                        $meta = json_decode((string) $e['metadata'], true);
                        $token = (is_array($meta) && !empty($meta['dw_job_token'])) ? $meta['dw_job_token'] : ('job_' . $e['id']); ?>
                    <tr>
                        <td><?php echo esc_html(self::fmt_time($e['created_at'], 'j M Y H:i:s')); ?></td>
                        <td>+<?php echo esc_html(preg_replace('/[^0-9]/', '', $e['phone'])); ?></td>
                        <td><code><?php echo esc_html($token); ?></code></td>
                        <td><span style="color: <?php echo esc_attr($lbl[1]); ?>; font-weight: 700;"><?php echo esc_html($lbl[0]); ?></span></td>
                    </tr>
                    <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    private static function render_integrations_tab($sender_health) {
        $settings = get_option('digiware_whatsapp_settings', array());
        $current_endpoint = !empty($settings['sender_endpoint']) ? $settings['sender_endpoint'] : WhatsAppSenderAdapter::SENDER_DEFAULT_ENDPOINT;
        ?>
        <div class="dw-card">
            <h2 style="margin-top: 0; font-size: 18px; font-weight: 800;">Intégrations &amp; Hub WhatsApp Sender</h2>
            <p style="font-size: 13px; color: #64748b;">
                Connexion directe avec l'application WhatsApp Sender (session Web réelle).
            </p>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                <h3 style="margin-top: 0; font-size: 14px; font-weight: 700;">Sélection Rapide d'Environnement Sender :</h3>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px;">
                    <button type="button" class="button" onclick="document.getElementById('dw_sender_endpoint').value='https://ais-pre-meyooihk7vtd2453i76tll-365608931211.europe-west2.run.app';">
                        🟢 Production / Partagée (ais-pre)
                    </button>
                    <button type="button" class="button" onclick="document.getElementById('dw_sender_endpoint').value='https://ais-dev-meyooihk7vtd2453i76tll-365608931211.europe-west2.run.app';">
                        🟡 Développement (ais-dev)
                    </button>
                    <button type="button" class="button" onclick="document.getElementById('dw_sender_endpoint').value='http://localhost:3000';">
                        💻 Local (:3000)
                    </button>
                </div>
            </div>

            <form method="POST">
                <?php wp_nonce_field('dw_wa_action_nonce'); ?>
                <input type="hidden" name="dw_wa_action" value="save_settings" />
                <table class="form-table">
                    <tr>
                        <th><label for="dw_sender_endpoint">URL Base WhatsApp Sender</label></th>
                        <td>
                            <input type="text" id="dw_sender_endpoint" name="sender_endpoint" value="<?php echo esc_attr($current_endpoint); ?>" class="large-text" style="font-family: monospace;" />
                            <p class="description">URL de l'application d'exécution qui gère la session WhatsApp Web réelle (ex: <code>https://ais-pre-zgivmj2nevegi7svqhki6j-365608931211.europe-west2.run.app</code>).</p>
                        </td>
                    </tr>
                    <tr>
                        <th><label>Clé d'API Secrète / Token (Optionnel)</label></th>
                        <td>
                            <input type="password" name="sender_api_key" value="<?php echo esc_attr(!empty($settings['sender_api_key']) ? $settings['sender_api_key'] : ''); ?>" class="regular-text" />
                        </td>
                    </tr>
                    <tr>
                        <th><label>Délai Anti-Blocage entre Envois</label></th>
                        <td>
                            <input type="number" name="sender_rate_limit" value="<?php echo esc_attr(!empty($settings['sender_rate_limit']) ? $settings['sender_rate_limit'] : 15); ?>" class="small-text" /> secondes
                        </td>
                    </tr>
                    <tr>
                        <th><label>Préfixe International par Défaut</label></th>
                        <td>
                            <input type="text" name="default_country_prefix" value="<?php echo esc_attr(!empty($settings['default_country_prefix']) ? $settings['default_country_prefix'] : '212'); ?>" class="small-text" /> (ex: 212 pour Maroc)
                        </td>
                    </tr>
                    <tr>
                        <th><label>Endpoint OmniTracker Bridge</label></th>
                        <td>
                            <input type="text" name="omnitracker_endpoint" value="<?php echo esc_attr(!empty($settings['omnitracker_endpoint']) ? $settings['omnitracker_endpoint'] : home_url('/wp-json/digiware/v1/omnitracker')); ?>" class="large-text" />
                        </td>
                    </tr>
                </table>
                <p class="submit">
                    <button type="submit" class="button button-primary button-large">Enregistrer les Paramètres &amp; Reconnecter</button>
                </p>
            </form>
        </div>
        <?php
    }
}
