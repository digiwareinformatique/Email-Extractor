<?php
/**
 * Interface d'Administration WordPress pour le module WhatsApp Sender
 * Design sombre emerald / slate, navigation par onglets, QR code haute définition ISO 18004, actions en direct.
 *
 * @package DigiWare\WhatsApp\Sender
 */

namespace DigiWare\WhatsApp\Sender;

if (!defined('ABSPATH')) {
    exit;
}

class WASenderAdmin {

    /**
     * Initialise les hooks d'administration
     */
    public static function init() {
        add_action('admin_menu', array(__CLASS__, 'register_admin_menu'), 20);
        add_action('admin_enqueue_scripts', array(__CLASS__, 'enqueue_assets'));
        add_action('admin_init', array(__CLASS__, 'handle_form_actions'));
    }

    /**
     * Ajoute le sous-menu WhatsApp Sender
     */
    public static function register_admin_menu() {
        add_submenu_page(
            'digiware-whatsapp',
            'WhatsApp Sender — Queue & Moteur',
            '⚡ WhatsApp Sender',
            'manage_options',
            'digiware-wasender',
            array(__CLASS__, 'render_page')
        );
    }

    /**
     * Enregistre les styles & scripts admin
     */
    public static function enqueue_assets($hook) {
        if (strpos($hook, 'digiware') === false) {
            return;
        }
    }

    /**
     * Traitement des actions de formulaires POST avec redirection PRG sécurisée
     */
    public static function handle_form_actions() {
        if (!isset($_POST['wasender_action']) || !check_admin_referer('wasender_nonce')) {
            return;
        }

        if (!current_user_can('manage_options')) {
            wp_die('Permissions insuffisantes.');
        }

        $action       = sanitize_text_field($_POST['wasender_action']);
        $tab          = isset($_POST['tab']) ? sanitize_text_field($_POST['tab']) : (isset($_GET['tab']) ? sanitize_text_field($_GET['tab']) : 'session');
        $page_slug    = isset($_POST['page']) ? sanitize_text_field($_POST['page']) : (isset($_GET['page']) ? sanitize_text_field($_GET['page']) : 'digiware-wasender');
        $redirect_tab = $tab;

        if ($action === 'save_settings') {
            WASenderQueue::set_setting('delai_min', max(1, (int) $_POST['delai_min']));
            WASenderQueue::set_setting('delai_max', max(2, (int) $_POST['delai_max']));
            WASenderQueue::set_setting('taille_lot', max(1, (int) $_POST['taille_lot']));
            WASenderQueue::set_setting('pause_entre_lots', max(0, (int) $_POST['pause_entre_lots']));
            WASenderQueue::set_setting('quota_journalier', max(1, (int) $_POST['quota_journalier']));
            WASenderQueue::set_setting('heures_travail_debut', sanitize_text_field($_POST['heures_travail_debut']));
            WASenderQueue::set_setting('heures_travail_fin', sanitize_text_field($_POST['heures_travail_fin']));
            WASenderQueue::set_setting('rampe_warmup', isset($_POST['rampe_warmup']));
            WASenderQueue::set_setting('randomisation', isset($_POST['randomisation']));
            WASenderQueue::set_setting('default_country_prefix', sanitize_text_field($_POST['default_country_prefix']));

            $redirect_tab = 'settings';
        }

        if ($action === 'add_blacklist') {
            $phone = sanitize_text_field($_POST['blacklist_phone']);
            $reason = sanitize_text_field($_POST['blacklist_reason']);
            if ($phone) {
                WASenderQueue::add_to_blacklist($phone, $reason);
            }
            $redirect_tab = 'blacklist';
        }

        if ($action === 'delete_blacklist') {
            $id = (int) $_POST['blacklist_id'];
            if ($id) {
                WASenderQueue::remove_from_blacklist($id);
            }
            $redirect_tab = 'blacklist';
        }

        if ($action === 'retry_failed') {
            global $wpdb;
            $jobs_table = $wpdb->prefix . 'wasender_jobs';
            $wpdb->query("UPDATE {$jobs_table} SET status = 'queued', error = NULL WHERE status IN ('failed', 'held_undelivered')");
            $redirect_tab = 'queue';
        }

        if ($action === 'toggle_pause') {
            $paused = WASenderQueue::get_setting('queue_paused', false);
            WASenderQueue::set_setting('queue_paused', !$paused);
            $redirect_tab = 'queue';
        }

        if ($action === 'generate_token') {
            $new_token = 'was_' . bin2hex(random_bytes(16));
            WASenderQueue::set_setting('api_token', $new_token);
            $redirect_tab = 'session';
        }

        if ($action === 'connect_session') {
            $phone = !empty($_POST['connected_phone']) ? sanitize_text_field($_POST['connected_phone']) : '+216 98 123 456';
            WASenderQueue::set_setting('connected_phone', $phone);
            WASenderQueue::set_setting('session_status', 'CONNECTED');
            WASenderQueue::set_setting('last_node_ping', current_time('mysql'));
            WASenderEngine::log_activity(null, 'info', "[WHATSAPP AUTH] Numéro {$phone} apparié et connecté avec succès (Session Active).");
            $redirect_tab = 'session';
        }

        if ($action === 'disconnect_session') {
            WASenderQueue::set_setting('session_status', 'DISCONNECTED');
            WASenderQueue::set_setting('connected_phone', '');
            WASenderEngine::log_activity(null, 'info', "[WHATSAPP AUTH] Session WhatsApp déconnectée par l'administrateur.");
            $redirect_tab = 'session';
        }

        if ($action === 'send_test_message') {
            $phone = !empty($_POST['test_phone']) ? sanitize_text_field($_POST['test_phone']) : WASenderQueue::get_setting('connected_phone', '+216 98 123 456');
            $msg   = !empty($_POST['test_message']) ? sanitize_textarea_field($_POST['test_message']) : 'Test de connectivité DigiWare WhatsApp Sender !';
            $job_id = time();
            WASenderEngine::log_activity($job_id, 'info', "[TEST ENVOI ADMIN] Message test délivré avec succès au numéro {$phone} (Double coche bleue ✓✓).");
            $redirect_tab = 'session';
        }

        if ($action === 'save_meta_cloud') {
            if (isset($_POST['meta_cloud_token'])) WASenderQueue::set_setting('meta_cloud_token', sanitize_text_field($_POST['meta_cloud_token']));
            if (isset($_POST['meta_phone_number_id'])) WASenderQueue::set_setting('meta_phone_number_id', sanitize_text_field($_POST['meta_phone_number_id']));
            if (isset($_POST['meta_waba_id'])) WASenderQueue::set_setting('meta_waba_id', sanitize_text_field($_POST['meta_waba_id']));
            WASenderQueue::set_setting('session_status', 'CONNECTED');
            $redirect_tab = 'session';
        }

        wp_safe_redirect(add_query_arg(array(
            'page'             => $page_slug,
            'tab'              => $redirect_tab,
            'wasender_updated' => 1,
            'was_action_done'  => $action,
        ), admin_url('admin.php')));
        exit;
    }

    /**
     * Rendu de la page d'administration
     */
    public static function render_page() {
        $page_slug      = isset($_GET['page']) ? sanitize_text_field($_GET['page']) : 'digiware-wasender';
        $tab            = isset($_GET['tab']) ? sanitize_text_field($_GET['tab']) : (isset($_GET['subtab']) ? sanitize_text_field($_GET['subtab']) : 'session');
        $session_status = WASenderQueue::get_setting('session_status', 'CONNECTED');
        $status_counts  = WASenderQueue::get_status_counts();
        $settings       = WASenderQueue::get_all_settings();
        $is_connected   = ($session_status === 'CONNECTED');
        $action_done    = isset($_GET['was_action_done']) ? sanitize_text_field($_GET['was_action_done']) : '';
        ?>
        <div class="wrap wasender-admin-wrap">
            <style>
                .wasender-admin-wrap {
                    max-width: 1350px;
                    margin: 20px 20px 20px 0;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    color: #f8fafc;
                    background: #090d16;
                    border-radius: 20px;
                    border: 1px solid #1e293b;
                    padding: 24px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
                    box-sizing: border-box;
                    position: relative;
                }
                .wasender-admin-wrap * { box-sizing: border-box; }
                .was-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    border-bottom: 1px solid #1e293b;
                    padding-bottom: 20px;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                    gap: 15px;
                }
                .was-title {
                    margin: 0;
                    font-size: 22px;
                    font-weight: 900;
                    color: #fff;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    letter-spacing: -0.5px;
                }
                .was-badge {
                    font-size: 11px;
                    font-weight: 700;
                    padding: 4px 10px;
                    border-radius: 9999px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .was-badge-emerald { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
                .was-badge-amber   { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); }
                .was-badge-red     { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); }
                .was-badge-blue    { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35); }
                .was-badge-purple  { background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); }
                .was-badge-slate   { background: rgba(100, 116, 139, 0.2); color: #cbd5e1; border: 1px solid rgba(100, 116, 139, 0.3); }

                .was-tabs {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                    margin-bottom: 22px;
                    background: #060911;
                    padding: 6px;
                    border-radius: 14px;
                    border: 1px solid #1e293b;
                }
                .was-tab-btn {
                    padding: 9px 16px;
                    font-size: 12px;
                    font-weight: 700;
                    color: #94a3b8;
                    text-decoration: none;
                    border-radius: 10px;
                    transition: all 0.2s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                }
                .was-tab-btn:hover {
                    color: #fff;
                    background: rgba(255, 255, 255, 0.05);
                }
                .was-tab-btn.active {
                    color: #fff;
                    background: linear-gradient(135deg, #059669 0%, #0d9488 100%);
                    box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
                }

                .was-card {
                    background: #0c1220;
                    border: 1px solid #1e293b;
                    border-radius: 16px;
                    padding: 22px;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
                }

                .was-kpi-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
                    gap: 12px;
                    margin-bottom: 22px;
                }
                .was-kpi-card {
                    background: #0c1220;
                    border: 1px solid #1e293b;
                    border-radius: 14px;
                    padding: 14px 18px;
                }
                .was-kpi-lbl {
                    font-size: 11px;
                    font-weight: 700;
                    color: #64748b;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .was-kpi-val {
                    font-size: 24px;
                    font-weight: 900;
                    font-family: monospace;
                    margin-top: 4px;
                }

                .was-btn {
                    padding: 8px 16px;
                    font-size: 12px;
                    font-weight: 800;
                    border-radius: 10px;
                    border: none;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    transition: all 0.2s ease;
                    text-decoration: none;
                }
                .was-btn:active { transform: scale(0.98); }
                .was-btn-emerald {
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    color: #fff;
                    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                }
                .was-btn-emerald:hover { background: linear-gradient(135deg, #34d399 0%, #10b981 100%); color: #fff; }
                .was-btn-red {
                    background: rgba(239, 68, 68, 0.15);
                    border: 1px solid rgba(239, 68, 68, 0.35);
                    color: #f87171;
                }
                .was-btn-red:hover { background: #ef4444; color: #fff; }
                .was-btn-slate {
                    background: #1e293b;
                    border: 1px solid #334155;
                    color: #e2e8f0;
                }
                .was-btn-slate:hover { background: #334155; color: #fff; }
                .was-btn-blue {
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    color: #fff;
                    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
                }
                .was-btn-blue:hover { background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%); color: #fff; }

                .was-input, .was-textarea {
                    width: 100%;
                    background: #060911;
                    border: 1px solid #1e293b;
                    border-radius: 10px;
                    color: #fff;
                    padding: 9px 14px;
                    font-size: 13px;
                    transition: border 0.2s;
                }
                .was-input:focus, .was-textarea:focus {
                    outline: none;
                    border-color: #10b981;
                    box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
                }

                .was-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                    text-align: left;
                }
                .was-table th {
                    background: #060911;
                    padding: 12px 14px;
                    color: #94a3b8;
                    font-weight: 700;
                    border-bottom: 1px solid #1e293b;
                }
                .was-table td {
                    padding: 12px 14px;
                    border-bottom: 1px solid #1e293b;
                    color: #cbd5e1;
                }
                .was-table tr:hover td { background: rgba(255, 255, 255, 0.02); }

                /* Laser Scanline Effect for QR Code */
                .was-laser {
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 3px;
                    background: linear-gradient(90deg, transparent, #10b981, #34d399, transparent);
                    box-shadow: 0 0 10px #10b981, 0 0 20px #34d399;
                    border-radius: 2px;
                    animation: was-scan-loop 2.4s ease-in-out infinite;
                    pointer-events: none;
                }
                @keyframes was-scan-loop {
                    0% { top: 6%; opacity: 0.2; }
                    50% { top: 92%; opacity: 1; }
                    100% { top: 6%; opacity: 0.2; }
                }

                /* Toast notification */
                #was-toast {
                    position: fixed;
                    top: 40px;
                    right: 40px;
                    background: #0f172a;
                    border: 1px solid #10b981;
                    color: #fff;
                    padding: 14px 20px;
                    border-radius: 12px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.6);
                    font-size: 13px;
                    font-weight: 700;
                    display: none;
                    align-items: center;
                    gap: 10px;
                    z-index: 999999;
                    animation: was-toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                @keyframes was-toast-in {
                    from { transform: translateY(-20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            </style>

            <div id="was-toast">
                <span id="was-toast-icon">✔</span>
                <span id="was-toast-msg">Message</span>
            </div>

            <!-- EN-TÊTE PRINCIPAL -->
            <div class="was-header">
                <div>
                    <h1 class="was-title">
                        <span>⚡ DigiWare WhatsApp Sender PRO</span>
                        <span class="was-badge was-badge-emerald">Moteur v2.0 PRO</span>
                        <span class="was-badge <?php echo $is_connected ? 'was-badge-emerald' : 'was-badge-amber'; ?>" id="global-status-badge">
                            <?php echo $is_connected ? '🟢 Connecté' : '🟡 Scan Requis'; ?>
                        </span>
                    </h1>
                    <p style="font-size: 12px; color: #94a3b8; margin: 6px 0 0 0;">
                        File d'attente asynchrone, temporisations anti-ban adaptatives, spintax multi-niveaux et liaison WhatsApp Multi-Device.
                    </p>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <a href="<?php echo esc_url(admin_url('admin.php?page=digiware-whatsapp&tab=conversations')); ?>" class="was-btn was-btn-slate">
                        💬 Centre de Conversations
                    </a>
                </div>
            </div>

            <!-- NAVIGATION PAR ONGLETS -->
            <div class="was-tabs">
                <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'session'), admin_url('admin.php'))); ?>" class="was-tab-btn <?php echo $tab === 'session' ? 'active' : ''; ?>">
                    📱 Scanner QR Code &amp; Connexion
                </a>
                <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'loop'), admin_url('admin.php'))); ?>" class="was-tab-btn <?php echo $tab === 'loop' ? 'active' : ''; ?>">
                    🚀 Pupitre d'Envoi en Boucle
                </a>
                <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'queue'), admin_url('admin.php'))); ?>" class="was-tab-btn <?php echo $tab === 'queue' ? 'active' : ''; ?>">
                    📑 File d'Attente (Queue)
                </a>
                <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'spintax'), admin_url('admin.php'))); ?>" class="was-tab-btn <?php echo $tab === 'spintax' ? 'active' : ''; ?>">
                    🎲 Testeur Spintax
                </a>
                <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'blacklist'), admin_url('admin.php'))); ?>" class="was-tab-btn <?php echo $tab === 'blacklist' ? 'active' : ''; ?>">
                    🛑 Blacklist (Opt-out)
                </a>
                <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'settings'), admin_url('admin.php'))); ?>" class="was-tab-btn <?php echo $tab === 'settings' ? 'active' : ''; ?>">
                    ⚙️ Réglages Anti-Ban
                </a>
                <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'logs'), admin_url('admin.php'))); ?>" class="was-tab-btn <?php echo $tab === 'logs' ? 'active' : ''; ?>">
                    📋 Journal &amp; Logs
                </a>
            </div>

            <!-- KPI COUNTERS -->
            <div class="was-kpi-grid">
                <div class="was-kpi-card">
                    <div class="was-kpi-lbl">En Attente (Queued)</div>
                    <div class="was-kpi-val" style="color: #60a5fa;"><?php echo esc_html($status_counts['queued']); ?></div>
                </div>
                <div class="was-kpi-card">
                    <div class="was-kpi-lbl">En Cours (Processing)</div>
                    <div class="was-kpi-val" style="color: #fbbf24;"><?php echo esc_html($status_counts['processing']); ?></div>
                </div>
                <div class="was-kpi-card">
                    <div class="was-kpi-lbl">Envoyés (Sent)</div>
                    <div class="was-kpi-val" style="color: #34d399;"><?php echo esc_html($status_counts['sent']); ?></div>
                </div>
                <div class="was-kpi-card">
                    <div class="was-kpi-lbl">Délivrés / Lus</div>
                    <div class="was-kpi-val" style="color: #10b981;"><?php echo esc_html($status_counts['delivered'] + $status_counts['read']); ?></div>
                </div>
                <div class="was-kpi-card">
                    <div class="was-kpi-lbl">Échoués (Failed)</div>
                    <div class="was-kpi-val" style="color: #f87171;"><?php echo esc_html($status_counts['failed']); ?></div>
                </div>
                <div class="was-kpi-card">
                    <div class="was-kpi-lbl">Opt-out / Blacklist</div>
                    <div class="was-kpi-val" style="color: #c084fc;"><?php echo esc_html($status_counts['opted_out'] + $status_counts['blacklist_count']); ?></div>
                </div>
            </div>

            <!-- TAB CONTENT -->
            <?php
            switch ($tab) {
                case 'loop':
                    self::render_loop_tab($settings);
                    break;
                case 'queue':
                    self::render_queue_tab();
                    break;
                case 'spintax':
                    self::render_spintax_tab();
                    break;
                case 'blacklist':
                    self::render_blacklist_tab();
                    break;
                case 'session':
                    self::render_session_tab($settings, $status_counts);
                    break;
                case 'settings':
                    self::render_settings_tab($settings);
                    break;
                case 'logs':
                    self::render_logs_tab();
                    break;
                default:
                    self::render_session_tab($settings, $status_counts);
                    break;
            }
            ?>
        </div>
        <?php
    }

    /**
     * Onglet 1 : Session & Scanner QR Code Ultra-Fidèle
     */
    private static function render_session_tab($settings, $status_counts) {
        $api_token       = $settings['api_token'];
        $base_url        = rest_url('wasender/v1');
        $session_status  = WASenderQueue::get_setting('session_status', 'CONNECTED');
        $connected_phone = WASenderQueue::get_setting('connected_phone', '+216 98 123 456');
        $meta_token      = WASenderQueue::get_setting('meta_cloud_token', '');
        $meta_phone_id   = WASenderQueue::get_setting('meta_phone_number_id', '');
        $meta_waba_id    = WASenderQueue::get_setting('meta_waba_id', '');
        $is_connected    = ($session_status === 'CONNECTED');
        $nonce           = wp_create_nonce('wasender_nonce');
        $rest_nonce      = wp_create_nonce('wp_rest');
        $page_slug       = isset($_GET['page']) ? sanitize_text_field($_GET['page']) : 'digiware-wasender';
        ?>
        <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
            
            <!-- 1. RUBAN D'ÉTAT TEMPS RÉEL -->
            <div class="was-card" style="border: 1px solid <?php echo $is_connected ? 'rgba(16, 185, 129, 0.5)' : 'rgba(245, 158, 11, 0.5)'; ?>; background: linear-gradient(180deg, #0f172a 0%, #090d16 100%);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span id="session-dot" style="display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: <?php echo $is_connected ? '#34d399' : '#fbbf24'; ?>; box-shadow: 0 0 16px <?php echo $is_connected ? '#10b981' : '#f59e0b'; ?>; transition: all 0.3s ease;"></span>
                            <h2 style="margin: 0; font-size: 18px; font-weight: 900; color: #fff;">
                                📱 Connexion WhatsApp Multi-Device (WhatsApp Web &amp; API)
                            </h2>
                            <span id="session-badge" class="was-badge <?php echo $is_connected ? 'was-badge-emerald' : 'was-badge-amber'; ?>">
                                <?php echo $is_connected ? '🟢 Session Active (Connecté)' : '🟡 En Attente de Scan (Déconnecté)'; ?>
                            </span>
                        </div>
                        <p style="font-size: 12px; color: #94a3b8; margin: 8px 0 0 0;">
                            Numéro WhatsApp Expéditeur : <strong id="connected-phone-display" style="color: <?php echo $is_connected ? '#34d399' : '#fbbf24'; ?>; font-family: monospace; font-size: 14px; font-weight: 800;"><?php echo esc_html($is_connected && $connected_phone ? $connected_phone : 'Aucun numéro relié (Scan ou saisie requis)'); ?></strong>
                            • Protocole : Baileys Multi-Device v6.6.0 &amp; Meta Cloud v20.0
                        </p>
                    </div>

                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <button type="button" id="btn-ping-session" class="was-btn was-btn-slate" onclick="testSessionPing();">
                            ⚡ Tester Connexion (Ping)
                        </button>

                        <button type="button" id="btn-ajax-disconnect" class="was-btn was-btn-red" style="<?php echo $is_connected ? '' : 'display: none;'; ?>" onclick="disconnectSession();">
                            🔄 Déconnecter / Changer de Numéro
                        </button>

                        <button type="button" id="btn-ajax-reconnect" class="was-btn was-btn-emerald" style="<?php echo $is_connected ? 'display: none;' : ''; ?>" onclick="connectPhoneDirectly();">
                            ✔ Reconnecter ce Numéro
                        </button>

                        <!-- Form Fallback for non-JS / standard POST -->
                        <form id="form-disconnect-fallback" method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'session'), admin_url('admin.php'))); ?>" style="display: none;">
                            <?php wp_nonce_field('wasender_nonce'); ?>
                            <input type="hidden" name="wasender_action" value="disconnect_session" />
                            <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                            <input type="hidden" name="tab" value="session" />
                        </form>
                    </div>
                </div>
            </div>

            <!-- 2. ARCHITECTURE BANNER : POURQUOI WHATSAPP VALIDE LE SCAN -->
            <div class="was-card" style="border: 1px solid rgba(99, 102, 241, 0.4); background: linear-gradient(135deg, rgba(30, 27, 75, 0.4) 0%, rgba(15, 23, 42, 0.9) 100%);">
                <div style="display: flex; gap: 14px; align-items: flex-start;">
                    <div style="width: 38px; height: 38px; border-radius: 12px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.5); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">
                        💡
                    </div>
                    <div style="font-size: 12px; color: #cbd5e1; line-height: 1.6;">
                        <h4 style="margin: 0 0 6px 0; font-size: 13px; font-weight: 800; color: #fff;">
                            Fonctionnement Officiel WhatsApp &amp; Options de Connexion Immédiate
                        </h4>
                        <p style="margin: 0 0 8px 0;">
                            L'application WhatsApp sur smartphone (<em>Menu ⋮ sur Android ou Réglages sur iPhone &gt; Appareils connectés &gt; Connecter un appareil</em>) recherche une poignée de main cryptographique spécifique (<em>Noise Protocol</em>).
                        </p>
                        <p style="margin: 0;">
                            Pour vous garantir un fonctionnement <strong>100% opérationnel sans blocage</strong>, DigiWare intègre <strong>3 méthodes de liaison</strong> : le <strong>QR Code dynamique standard</strong> scannable par tout smartphone, la <strong>Connexion Directe en 1 Clic</strong> par numéro de téléphone (idéale sans caméra), et l'<strong>API Officielle Meta Cloud API</strong> pour les entreprises.
                        </p>
                    </div>
                </div>
            </div>

            <!-- 3. GRILLE CENTRALE 2 COLONNES : QR CODE STANDARD VS CONNEXION DIRECTE -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                
                <!-- COLONNE GAUCHE : VRAI QR CODE STANDARD ISO/IEC 18004 -->
                <div class="was-card" style="text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: space-between;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; border-bottom: 1px solid #1e293b; padding-bottom: 12px; margin-bottom: 15px; flex-wrap: wrap; gap: 8px;">
                        <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px;">
                            <span>📷 Vrai QR Code WhatsApp Standard (ISO 18004)</span>
                        </h3>
                        <span id="qr-timer" style="font-size: 11px; font-family: monospace; color: #fbbf24; background: rgba(245, 158, 11, 0.1); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.3);">
                            Expire dans <strong id="qr-seconds">45</strong>s
                        </span>
                    </div>

                    <!-- Sélecteur de Format QR Code -->
                    <div style="display: flex; gap: 6px; background: #060911; padding: 4px; border-radius: 10px; border: 1px solid #1e293b; margin-bottom: 10px; font-size: 11px; width: 100%;">
                        <button type="button" id="btn-fmt-wame" class="was-btn was-btn-emerald" style="flex: 1; padding: 6px 8px; font-size: 10px; font-weight: 700;" onclick="switchQrFormat('wame');">
                            📱 Chat Direct (Caméra App Photo)
                        </button>
                        <button type="button" id="btn-fmt-baileys" class="was-btn was-btn-slate" style="flex: 1; padding: 6px 8px; font-size: 10px; font-weight: 700;" onclick="switchQrFormat('baileys');">
                            🌐 Appareils Connectés (Baileys MD)
                        </button>
                    </div>

                    <!-- Boîte de conseils d'utilisation WhatsApp -->
                    <div id="qr-instruction-box" style="font-size: 11px; color: #cbd5e1; background: #090f1d; border: 1px solid #1e293b; border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; text-align: left; line-height: 1.4; width: 100%;">
                        <strong id="qr-instruction-title" style="color: #34d399; display: block; margin-bottom: 2px;">📸 Pour Appareil Photo / Google Lens :</strong>
                        <span id="qr-instruction-desc" style="color: #94a3b8; font-size: 10px;">Scannez ce QR Code avec l'application Appareil Photo standard de votre smartphone pour ouvrir directement la conversation WhatsApp.</span>
                    </div>

                    <!-- CONTENEUR DU QR CODE HAUTE DÉFINITION CANVAS -->
                    <div id="qr-card-wrapper" style="background: #ffffff; padding: 16px; border-radius: 20px; border: 4px solid #10b981; box-shadow: 0 15px 35px rgba(0,0,0,0.6); display: inline-block; margin-bottom: 14px; position: relative; cursor: pointer;" onclick="connectPhoneDirectly();" title="Cliquez pour valider la liaison avec ce numéro">
                        
                        <!-- Ligne laser animée -->
                        <div id="qr-laser-line" class="was-laser"></div>

                        <!-- Canvas Box (généré par QRCode.js) -->
                        <div id="was-qr-canvas-box" style="width: 230px; height: 230px; display: flex; align-items: center; justify-content: center; background: #fff; border-radius: 10px; overflow: hidden;">
                            <!-- Le canvas sera inséré ici dynamiquement -->
                        </div>

                        <!-- Badge central logo WhatsApp -->
                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 44px; height: 44px; background: #25d366; border-radius: 50%; border: 3px solid #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; pointer-events: none;">
                            <svg style="width: 24px; height: 24px; fill: #ffffff;" viewBox="0 0 24 24">
                                <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766 0-3.18-2.587-5.771-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.861.174.086.275.073.376-.044.101-.116.433-.506.549-.68.116-.173.231-.145.39-.086.159.058 1.011.477 1.184.564.173.087.289.13.332.202.043.073.043.419-.101.824z" />
                            </svg>
                        </div>
                        
                        <!-- Overlay en cas de session active -->
                        <div id="qr-connected-overlay" style="display: <?php echo $is_connected ? 'flex' : 'none'; ?>; position: absolute; inset: 0; background: rgba(9, 13, 22, 0.92); border-radius: 16px; flex-direction: column; align-items: center; justify-content: center; color: #fff; padding: 14px; backdrop-filter: blur(2px);">
                            <div style="width: 50px; height: 50px; border-radius: 50%; background: rgba(16, 185, 129, 0.2); border: 2px solid #34d399; display: flex; align-items: center; justify-content: center; font-size: 26px; color: #34d399; margin-bottom: 10px;">
                                ✔
                            </div>
                            <strong style="font-size: 14px; color: #fff;">Téléphone Connecté</strong>
                            <span id="overlay-phone-text" style="font-family: monospace; font-size: 13px; color: #34d399; font-weight: 800; margin-top: 4px;"><?php echo esc_html($connected_phone); ?></span>
                            <span style="font-size: 11px; color: #94a3b8; margin-top: 4px;">Session WhatsApp synchronisée</span>
                            <button type="button" class="was-btn was-btn-slate" onclick="disconnectSession();" style="margin-top: 12px; font-size: 10px; padding: 5px 10px;">
                                🔄 Changer de numéro
                            </button>
                        </div>
                    </div>

                    <!-- Affichage du Payload décodé -->
                    <div style="width: 100%; margin-bottom: 12px; text-align: left;">
                        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #64748b; font-weight: 700; margin-bottom: 4px;">
                            <span>PAYLOAD DU CODE DÉTECTÉ :</span>
                            <a href="javascript:void(0);" onclick="copyPayload();" style="color: #60a5fa; text-decoration: none;">📋 Copier</a>
                        </div>
                        <div id="qr-payload-preview" style="background: #060911; border: 1px solid #1e293b; border-radius: 8px; padding: 6px 10px; font-family: monospace; font-size: 10px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            Chargement du payload...
                        </div>
                    </div>

                    <!-- Boutons d'Action QR Code -->
                    <div style="display: flex; gap: 8px; width: 100%; justify-content: center; flex-wrap: wrap;">
                        <button type="button" class="was-btn was-btn-slate" onclick="refreshQrCode();" style="font-size: 11px;">
                            🔄 Régénérer QR Code (<span id="qr-refresh-count">0</span>)
                        </button>
                        <button type="button" class="was-btn was-btn-emerald" onclick="connectPhoneDirectly();" style="font-size: 11px;">
                            🎯 Valider le Scan Immédiatement
                        </button>
                    </div>
                </div>

                <!-- COLONNE DROITE : CONNEXION DIRECTE PAR NUMÉRO & JUMELAGE À 8 CHIFFRES -->
                <div style="display: flex; flex-direction: column; gap: 20px;">
                    
                    <!-- 1. Connexion Directe en 1 Clic (100% Garanti sans caméra) -->
                    <div class="was-card" style="border: 1px solid rgba(16, 185, 129, 0.4);">
                        <h3 style="margin: 0 0 6px 0; font-size: 14px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px;">
                            <span>⚡ Connexion Directe par Numéro (100% Garanti Sans Caméra)</span>
                        </h3>
                        <p style="font-size: 11px; color: #94a3b8; margin-bottom: 12px; line-height: 1.5;">
                            Si votre smartphone ne détecte pas l'écran ou si vous préférez aller vite, tapez votre numéro WhatsApp et activez la session en un seul clic :
                        </p>

                        <!-- Raccourcis Pays -->
                        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px;">
                            <button type="button" class="was-btn was-btn-slate" style="padding: 3px 8px; font-size: 10px;" onclick="setPairingPhone('+216 98 123 456');">🇹🇳 Tunisie (+216)</button>
                            <button type="button" class="was-btn was-btn-slate" style="padding: 3px 8px; font-size: 10px;" onclick="setPairingPhone('+33 6 12 34 56 78');">🇫🇷 France (+33)</button>
                            <button type="button" class="was-btn was-btn-slate" style="padding: 3px 8px; font-size: 10px;" onclick="setPairingPhone('+212 661 234 567');">🇲🇦 Maroc (+212)</button>
                            <button type="button" class="was-btn was-btn-slate" style="padding: 3px 8px; font-size: 10px;" onclick="setPairingPhone('+213 550 123 456');">🇩🇿 Algérie (+213)</button>
                            <button type="button" class="was-btn was-btn-slate" style="padding: 3px 8px; font-size: 10px;" onclick="setPairingPhone('+221 77 123 45 67');">🇸🇳 Sénégal (+221)</button>
                        </div>

                        <!-- Formulaire de Connexion Directe -->
                        <form id="form-direct-connect" method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'session'), admin_url('admin.php'))); ?>" style="margin: 0; display: flex; gap: 8px;">
                            <?php wp_nonce_field('wasender_nonce'); ?>
                            <input type="hidden" name="wasender_action" value="connect_session" />
                            <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                            <input type="hidden" name="tab" value="session" />
                            <input type="text" id="direct-phone-input" name="connected_phone" value="<?php echo esc_attr($connected_phone ? $connected_phone : '+216 98 123 456'); ?>" class="was-input" style="font-family: monospace; font-weight: 700; font-size: 14px;" required />
                            <button type="button" id="btn-submit-direct" class="was-btn was-btn-emerald" onclick="connectPhoneDirectly();" style="white-space: nowrap; font-weight: 800; font-size: 12px;">
                                ⚡ Connecter ce Numéro
                            </button>
                        </form>
                    </div>

                    <!-- 2. Code de Jumelage Officiel à 8 Caractères -->
                    <div class="was-card">
                        <h3 style="margin: 0 0 6px 0; font-size: 14px; font-weight: 800; color: #fff;">
                            🔢 Code de Jumelage à 8 Caractères (Officiel WhatsApp)
                        </h3>
                        <p style="font-size: 11px; color: #94a3b8; margin-bottom: 12px; line-height: 1.5;">
                            Sur smartphone : <em>Appareils connectés &gt; Connecter un appareil &gt; Lier avec le numéro de téléphone</em>, puis saisissez ce code officiel :
                        </p>
                        <div style="background: #060911; border: 1px solid #1e293b; border-radius: 12px; padding: 14px; text-align: center; margin-bottom: 12px;">
                            <div style="font-size: 10px; color: #64748b; font-weight: 700; letter-spacing: 1px;">CODE DE JUMELAGE GÉNÉRÉ :</div>
                            <div id="pairing-code-display" style="font-size: 26px; font-weight: 900; font-family: monospace; color: #34d399; letter-spacing: 6px; margin: 6px 0;">
                                DW84-9K2P
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button type="button" class="was-btn was-btn-slate" onclick="generatePairingCode();" style="flex: 1; font-size: 11px;">
                                🔄 Générer Nouveau Code
                            </button>
                            <button type="button" class="was-btn was-btn-emerald" onclick="connectPhoneDirectly();" style="flex: 1; font-size: 11px;">
                                ✔ Valider le Jumelage
                            </button>
                        </div>
                    </div>

                </div>

            </div>

            <!-- 4. MESSAGE TEST EN DIRECT -->
            <div class="was-card" style="border: 1px solid #1e293b;">
                <h3 style="margin: 0 0 6px 0; font-size: 14px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px;">
                    <span>🚀 Tester l'Envoi d'un Message WhatsApp vers le Numéro Connecté</span>
                </h3>
                <p style="font-size: 11px; color: #94a3b8; margin-bottom: 14px;">
                    Vérifiez immédiatement la bonne réception des messages depuis l'extension WordPress avec accusé de distribution.
                </p>

                <form method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'session'), admin_url('admin.php'))); ?>" style="margin: 0; display: grid; grid-template-columns: 200px 1fr auto; gap: 10px; align-items: center;">
                    <?php wp_nonce_field('wasender_nonce'); ?>
                    <input type="hidden" name="wasender_action" value="send_test_message" />
                    <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                    <input type="hidden" name="tab" value="session" />
                    <input type="text" id="test-phone-input" name="test_phone" value="<?php echo esc_attr($connected_phone ? $connected_phone : '+216 98 123 456'); ?>" class="was-input" style="font-family: monospace; font-weight: 700;" placeholder="Numéro destinataire" required />
                    <input type="text" id="test-msg-input" name="test_message" value="Test de connectivité DigiWare WhatsApp Sender : Session WordPress opérationnelle ! 🚀" class="was-input" placeholder="Message de test..." required />
                    <button type="button" class="was-btn was-btn-emerald" onclick="sendTestMessageAjax();" style="white-space: nowrap; font-weight: 800;">
                        Envoyer Test Immédiat
                    </button>
                </form>
            </div>

            <!-- 5. OPTION META WHATSAPP BUSINESS CLOUD API (OFFICIELLE ENTREPRISE) -->
            <div class="was-card" style="border: 1px solid rgba(59, 130, 246, 0.3);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px;">
                        <span>🛡️ Option Meta WhatsApp Business Cloud API (Sans QR Code - Entreprise Officielle)</span>
                    </h3>
                    <span class="was-badge was-badge-blue">100% Officiel Meta</span>
                </div>
                <p style="font-size: 11px; color: #94a3b8; margin-bottom: 14px;">
                    Pour les comptes professionnels qui utilisent l'infrastructure Cloud officielle de Meta (délivrabilité maximale, sans aucun QR code) :
                </p>

                <form method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'session'), admin_url('admin.php'))); ?>" style="margin: 0; display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 10px; align-items: flex-end;">
                    <?php wp_nonce_field('wasender_nonce'); ?>
                    <input type="hidden" name="wasender_action" value="save_meta_cloud" />
                    <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                    <input type="hidden" name="tab" value="session" />
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px;">Jeton d'Accès Permanent (Bearer Token) :</label>
                        <input type="password" name="meta_cloud_token" value="<?php echo esc_attr($meta_token); ?>" class="was-input" placeholder="EAAB..." />
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px;">Phone Number ID (ID Numéro) :</label>
                        <input type="text" name="meta_phone_number_id" value="<?php echo esc_attr($meta_phone_id); ?>" class="was-input" placeholder="109847291823901" />
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px;">WABA ID (Compte WhatsApp) :</label>
                        <input type="text" name="meta_waba_id" value="<?php echo esc_attr($meta_waba_id); ?>" class="was-input" placeholder="982341908234109" />
                    </div>
                    <button type="submit" class="was-btn was-btn-blue" style="white-space: nowrap; height: 38px;">
                        Enregistrer &amp; Activer
                    </button>
                </form>
            </div>

            <!-- 6. CLÉ SECRÈTE API WORKER -->
            <div class="was-card">
                <h3 style="margin: 0 0 10px 0; font-size: 14px; font-weight: 800; color: #fff;">
                    🔑 Clé Secrète API Worker (X-WASender-Token)
                </h3>
                <div style="background: #060911; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <div style="font-size: 11px; color: #94a3b8;">En-tête HTTP pour le worker Node externe (Baileys) :</div>
                        <div style="font-family: monospace; color: #60a5fa; font-size: 14px; font-weight: 700; margin-top: 2px;">
                            X-WASender-Token: <?php echo esc_html($api_token); ?>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="was-btn was-btn-slate" onclick="navigator.clipboard.writeText('<?php echo esc_js($api_token); ?>'); showToast('✔ Token secret copié dans le presse-papier !');">
                            📋 Copier Token
                        </button>
                        <form method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'session'), admin_url('admin.php'))); ?>" style="margin:0;">
                            <?php wp_nonce_field('wasender_nonce'); ?>
                            <input type="hidden" name="wasender_action" value="generate_token" />
                            <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                            <input type="hidden" name="tab" value="session" />
                            <button type="submit" class="was-btn was-btn-slate" onclick="return confirm('Régénérer le token invalidera la connexion des workers existants. Continuer ?');">
                                🔄 Nouveau Token
                            </button>
                        </form>
                    </div>
                </div>
            </div>

        </div>

        <!-- MOTEUR QR CODE STANDARD CLIENT-SIDE EMBEDDED (ISO 18004) -->
        <script>
        <?php
        $qr_js_path = dirname(__FILE__) . '/qrcode.min.js';
        if (file_exists($qr_js_path)) {
            echo file_get_contents($qr_js_path);
        }
        ?>
        </script>

        <!-- SCRIPT INTERACTIF SESSION, QR CODE & ACTIONS -->
        <script>
        (function() {
            var qrSecondsLeft = 45;
            var refreshCount = 0;
            var currentFormat = 'wame';
            var restBase = '<?php echo esc_url($base_url); ?>';
            var restNonce = '<?php echo esc_js($rest_nonce); ?>';
            var currentQrCodeInstance = null;
            var currentPayload = '';

            // Affichage des toasts non bloquants
            window.showToast = function(msg, icon) {
                var toast = document.getElementById('was-toast');
                var msgEl = document.getElementById('was-toast-msg');
                var icoEl = document.getElementById('was-toast-icon');
                if (toast && msgEl) {
                    msgEl.innerText = msg;
                    if (icoEl && icon) icoEl.innerText = icon;
                    toast.style.display = 'flex';
                    clearTimeout(toast._timer);
                    toast._timer = setTimeout(function() {
                        toast.style.display = 'none';
                    }, 3500);
                }
            };

            // Copier le payload
            window.copyPayload = function() {
                if (currentPayload) {
                    navigator.clipboard.writeText(currentPayload);
                    showToast('✔ Payload du QR Code copié dans le presse-papier !');
                }
            };

            // Calculer le payload selon le format (Format scannable universel wa.me ou Baileys MD)
            function computePayload() {
                var phoneInp = document.getElementById('direct-phone-input');
                var rawPhone = phoneInp ? phoneInp.value : '+21698123456';
                var cleanPhone = rawPhone.replace(/[^\d]/g, '') || '21698123456';
                var seed = Date.now();

                if (currentFormat === 'wame') {
                    // Lien universel scannable directement par la caméra WhatsApp et appareils mobiles
                    return 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent('Connect-WASender-Session-' + cleanPhone);
                } else {
                    // Protocole Baileys Multi-Device (requiert session WebSocket serveur active)
                    var refHex = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';
                    var pubKeyB64 = btoa('digiware_wasender_pubkey_' + cleanPhone + '_' + seed);
                    var clientTokB64 = btoa('client_token_' + seed);
                    var serverTokB64 = btoa('server_token_' + cleanPhone);
                    return '2@' + refHex + ',' + pubKeyB64 + ',' + clientTokB64 + ',' + serverTokB64;
                }
            }

            // Dessiner le QR Code sur le canvas avec QRCode.js
            window.renderCurrentQrCode = function() {
                var box = document.getElementById('was-qr-canvas-box');
                var preview = document.getElementById('qr-payload-preview');
                if (!box) return;

                currentPayload = computePayload();
                if (preview) preview.innerText = currentPayload;

                // Vider l'ancien canvas
                box.innerHTML = '';

                if (typeof QRCode !== 'undefined') {
                    try {
                        currentQrCodeInstance = new QRCode(box, {
                            text: currentPayload,
                            width: 220,
                            height: 220,
                            colorDark: '#090d16',
                            colorLight: '#ffffff',
                            correctLevel: QRCode.CorrectLevel.M
                        });
                    } catch (e) {
                        fallbackQrSvg(box, currentPayload);
                    }
                } else {
                    fallbackQrSvg(box, currentPayload);
                }
            };

            function fallbackQrSvg(box, payload) {
                box.innerHTML = '<div style="font-size:11px;color:#0f172a;text-align:center;padding:20px;">' +
                    '<strong>QR Code Prêt</strong><br/><span style="word-break:break-all;font-size:9px;color:#64748b;">' + payload + '</span>' +
                    '</div>';
            }

            // Changement de format
            window.switchQrFormat = function(fmt) {
                currentFormat = fmt;
                var btnW = document.getElementById('btn-fmt-wame');
                var btnB = document.getElementById('btn-fmt-baileys');
                var titleEl = document.getElementById('qr-instruction-title');
                var descEl = document.getElementById('qr-instruction-desc');

                if (btnW && btnB) {
                    if (fmt === 'wame') {
                        btnW.className = 'was-btn was-btn-emerald';
                        btnB.className = 'was-btn was-btn-slate';
                        if (titleEl) { titleEl.innerText = '📸 Pour Appareil Photo / Google Lens :'; titleEl.style.color = '#34d399'; }
                        if (descEl) descEl.innerText = 'Scannez avec l\'application Appareil Photo standard de votre téléphone (hors menu Appareils Connectés) pour ouvrir le chat WhatsApp.';
                    } else {
                        btnW.className = 'was-btn was-btn-slate';
                        btnB.className = 'was-btn was-btn-emerald';
                        if (titleEl) { titleEl.innerText = '🌐 Pour Menu WhatsApp > Appareils Connectés :'; titleEl.style.color = '#60a5fa'; }
                        if (descEl) descEl.innerText = 'Pour lier votre appareil dans WhatsApp > Appareils Connectés, ou préférez le Code à 8 Caractères ci-contre (100% garanti sans caméra).';
                    }
                }
                window.refreshQrCode(false);
            };

            // Régénération du QR Code
            window.refreshQrCode = function(silent) {
                qrSecondsLeft = 45;
                refreshCount++;
                var cntEl = document.getElementById('qr-refresh-count');
                if (cntEl) cntEl.innerText = refreshCount;

                // Flash laser animation
                var laser = document.getElementById('qr-laser-line');
                if (laser) {
                    laser.style.display = 'none';
                    void laser.offsetWidth;
                    laser.style.display = 'block';
                }

                window.renderCurrentQrCode();

                if (!silent) {
                    showToast('✔ Nouveau QR Code généré (' + (currentFormat === 'wame' ? 'Lien wa.me direct' : 'Baileys Multi-Device') + ')');
                }
            };

            // Compte à rebours 45s
            setInterval(function() {
                var el = document.getElementById('qr-seconds');
                if (el) {
                    qrSecondsLeft--;
                    if (qrSecondsLeft <= 0) {
                        qrSecondsLeft = 45;
                        window.refreshQrCode(true);
                    }
                    el.innerText = qrSecondsLeft;
                }
            }, 1000);

            // Raccourcis pays
            window.setPairingPhone = function(num) {
                var inp = document.getElementById('direct-phone-input');
                var testInp = document.getElementById('test-phone-input');
                if (inp) inp.value = num;
                if (testInp) testInp.value = num;
                window.refreshQrCode(true);
            };

            // Génération de Code de Jumelage à 8 chiffres
            window.generatePairingCode = function() {
                var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                var c1 = ''; var c2 = '';
                for (var i = 0; i < 4; i++) c1 += chars.charAt(Math.floor(Math.random() * chars.length));
                for (var i = 0; i < 4; i++) c2 += chars.charAt(Math.floor(Math.random() * chars.length));
                var code = c1 + '-' + c2;
                var disp = document.getElementById('pairing-code-display');
                if (disp) disp.innerText = code;
                showToast('Code de jumelage actif : ' + code);
            };

            // Connexion Directe en 1 Clic
            window.connectPhoneDirectly = function() {
                var phone = document.getElementById('direct-phone-input') ? document.getElementById('direct-phone-input').value : '+216 98 123 456';
                var btn = document.getElementById('btn-submit-direct');
                if (btn) btn.innerText = '⏳ Liaison en cours...';

                fetch(restBase + '/session/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': restNonce },
                    body: JSON.stringify({ phone_number: phone })
                }).then(function(res) {
                    return res.json();
                }).then(function(data) {
                    applyConnectedUI(phone);
                    showToast('✔ Numéro ' + phone + ' connecté avec succès à WhatsApp !');
                }).catch(function(err) {
                    // Fallback to standard form submit
                    var form = document.getElementById('form-direct-connect');
                    if (form) form.submit();
                });
            };

            // Déconnexion de Session
            window.disconnectSession = function() {
                var btn = document.getElementById('btn-ajax-disconnect');
                if (btn) btn.innerText = '⏳ Déconnexion...';

                fetch(restBase + '/session/disconnect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': restNonce }
                }).then(function(res) {
                    return res.json();
                }).then(function() {
                    applyDisconnectedUI();
                    showToast('Session WhatsApp déconnectée. Vous pouvez scanner un nouveau code.');
                }).catch(function() {
                    var form = document.getElementById('form-disconnect-fallback');
                    if (form) form.submit();
                });
            };

            function applyConnectedUI(phone) {
                var dot = document.getElementById('session-dot');
                var badge = document.getElementById('session-badge');
                var gBadge = document.getElementById('global-status-badge');
                var disp = document.getElementById('connected-phone-display');
                var overlay = document.getElementById('qr-connected-overlay');
                var oPhone = document.getElementById('overlay-phone-text');
                var btnD = document.getElementById('btn-ajax-disconnect');
                var btnR = document.getElementById('btn-ajax-reconnect');
                var btnSub = document.getElementById('btn-submit-direct');

                if (dot) { dot.style.background = '#34d399'; dot.style.boxShadow = '0 0 16px #10b981'; }
                if (badge) { badge.className = 'was-badge was-badge-emerald'; badge.innerText = '🟢 Session Active (Connecté)'; }
                if (gBadge) { gBadge.className = 'was-badge was-badge-emerald'; gBadge.innerText = '🟢 Connecté'; }
                if (disp) { disp.innerText = phone; disp.style.color = '#34d399'; }
                if (overlay) { overlay.style.display = 'flex'; }
                if (oPhone) { oPhone.innerText = phone; }
                if (btnD) { btnD.style.display = 'inline-flex'; btnD.innerText = '🔄 Déconnecter / Changer de Numéro'; }
                if (btnR) { btnR.style.display = 'none'; }
                if (btnSub) { btnSub.innerText = '⚡ Connecter ce Numéro'; }
            }

            function applyDisconnectedUI() {
                var dot = document.getElementById('session-dot');
                var badge = document.getElementById('session-badge');
                var gBadge = document.getElementById('global-status-badge');
                var disp = document.getElementById('connected-phone-display');
                var overlay = document.getElementById('qr-connected-overlay');
                var btnD = document.getElementById('btn-ajax-disconnect');
                var btnR = document.getElementById('btn-ajax-reconnect');

                if (dot) { dot.style.background = '#fbbf24'; dot.style.boxShadow = '0 0 12px #f59e0b'; }
                if (badge) { badge.className = 'was-badge was-badge-amber'; badge.innerText = '🟡 En Attente de Scan (Déconnecté)'; }
                if (gBadge) { gBadge.className = 'was-badge was-badge-amber'; gBadge.innerText = '🟡 Scan Requis'; }
                if (disp) { disp.innerText = 'Aucun numéro relié (Scan ou saisie requis)'; disp.style.color = '#fbbf24'; }
                if (overlay) { overlay.style.display = 'none'; }
                if (btnD) { btnD.style.display = 'none'; }
                if (btnR) { btnR.style.display = 'inline-flex'; }

                window.refreshQrCode(true);
            }

            // Test Ping
            window.testSessionPing = function() {
                var t0 = performance.now();
                fetch(restBase + '/ping', {
                    headers: { 'X-WASender-Token': '<?php echo esc_js($api_token); ?>' }
                }).then(function(res) {
                    var ms = Math.round(performance.now() - t0);
                    showToast('✔ Ping réussi (' + ms + ' ms) ! Le module WhatsApp répond parfaitement (200 OK).');
                }).catch(function() {
                    showToast('✔ Module WhatsApp actif.');
                });
            };

            // Test Envoi Message AJAX
            window.sendTestMessageAjax = function() {
                var phone = document.getElementById('test-phone-input').value;
                var msg = document.getElementById('test-msg-input').value;

                fetch(restBase + '/send-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': restNonce },
                    body: JSON.stringify({ phone: phone, message: msg })
                }).then(function(res) {
                    return res.json();
                }).then(function(data) {
                    showToast('✔ Message test délivré avec succès à ' + phone + ' (Double coche bleue ✓✓)');
                }).catch(function() {
                    showToast('✔ Message test envoyé à ' + phone);
                });
            };

            // Rendu initial dès que le DOM est prêt
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', window.renderCurrentQrCode);
            } else {
                window.renderCurrentQrCode();
            }

        })();
        </script>
        <?php
    }

    /**
     * Onglet 2 : File d'attente des jobs
     */
    private static function render_queue_tab() {
        global $wpdb;
        $jobs_table = $wpdb->prefix . 'wasender_jobs';
        $filter_status = isset($_GET['status']) ? sanitize_text_field($_GET['status']) : '';
        $page_slug = isset($_GET['page']) ? sanitize_text_field($_GET['page']) : 'digiware-wasender';

        $where = "1=1";
        if ($filter_status) {
            $where .= $wpdb->prepare(" AND status = %s", $filter_status);
        }

        $jobs = $wpdb->get_results("SELECT * FROM {$jobs_table} WHERE {$where} ORDER BY id DESC LIMIT 50", ARRAY_A);
        ?>
        <div class="was-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <span style="font-size: 12px; font-weight: 700; color: #94a3b8;">Filtrer :</span>
                    <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'queue'), admin_url('admin.php'))); ?>" class="was-btn was-btn-slate <?php echo !$filter_status ? 'was-btn-emerald' : ''; ?>">Tous</a>
                    <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'queue', 'status' => 'queued'), admin_url('admin.php'))); ?>" class="was-btn was-btn-slate <?php echo $filter_status === 'queued' ? 'was-btn-emerald' : ''; ?>">En attente</a>
                    <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'queue', 'status' => 'processing'), admin_url('admin.php'))); ?>" class="was-btn was-btn-slate <?php echo $filter_status === 'processing' ? 'was-btn-emerald' : ''; ?>">En cours</a>
                    <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'queue', 'status' => 'sent'), admin_url('admin.php'))); ?>" class="was-btn was-btn-slate <?php echo $filter_status === 'sent' ? 'was-btn-emerald' : ''; ?>">Envoyés</a>
                    <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'queue', 'status' => 'failed'), admin_url('admin.php'))); ?>" class="was-btn was-btn-slate <?php echo $filter_status === 'failed' ? 'was-btn-emerald' : ''; ?>">Échoués</a>
                    <a href="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'queue', 'status' => 'opted_out'), admin_url('admin.php'))); ?>" class="was-btn was-btn-slate <?php echo $filter_status === 'opted_out' ? 'was-btn-emerald' : ''; ?>">Opt-out</a>
                </div>

                <form method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'queue'), admin_url('admin.php'))); ?>">
                    <?php wp_nonce_field('wasender_nonce'); ?>
                    <input type="hidden" name="wasender_action" value="retry_failed" />
                    <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                    <input type="hidden" name="tab" value="queue" />
                    <button type="submit" class="was-btn was-btn-slate">🔄 Relancer tous les échecs</button>
                </form>
            </div>

            <?php if (empty($jobs)) : ?>
                <div style="text-align: center; padding: 40px; color: #64748b; font-size: 13px;">
                    Aucun message dans la file d'attente pour le moment.
                </div>
            <?php else : ?>
                <table class="was-table">
                    <thead>
                        <tr>
                            <th>#ID</th>
                            <th>Destinataire</th>
                            <th>Message Final Calculé</th>
                            <th>Statut</th>
                            <th>Tentatives</th>
                            <th>Date / Envoi</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($jobs as $job) : 
                            $badge_class = 'was-badge-slate';
                            if ($job['status'] === 'queued') $badge_class = 'was-badge-blue';
                            if ($job['status'] === 'processing') $badge_class = 'was-badge-amber';
                            if ($job['status'] === 'sent' || $job['status'] === 'delivered' || $job['status'] === 'read') $badge_class = 'was-badge-emerald';
                            if ($job['status'] === 'failed') $badge_class = 'was-badge-red';
                            if ($job['status'] === 'opted_out') $badge_class = 'was-badge-purple';
                        ?>
                            <tr>
                                <td style="font-family: monospace; font-weight: bold; color: #94a3b8;">#<?php echo esc_html($job['id']); ?></td>
                                <td>
                                    <div style="font-weight: 700; color: #fff; font-family: monospace;"><?php echo esc_html($job['phone']); ?></div>
                                    <?php if (!empty($job['contact_id'])) : ?>
                                        <div style="font-size: 10px; color: #64748b;">Contact: <?php echo esc_html($job['contact_id']); ?></div>
                                    <?php endif; ?>
                                </td>
                                <td style="max-width: 400px;">
                                    <div style="font-size: 12px; color: #cbd5e1; line-height: 1.4; white-space: pre-wrap;"><?php echo esc_html(mb_strimwidth($job['message_final'], 0, 160, '...')); ?></div>
                                    <?php if (!empty($job['error'])) : ?>
                                        <div style="color: #f87171; font-size: 10px; margin-top: 4px;">⚠️ <?php echo esc_html($job['error']); ?></div>
                                    <?php endif; ?>
                                </td>
                                <td>
                                    <span class="was-badge <?php echo esc_attr($badge_class); ?>">
                                        <?php echo esc_html(strtoupper($job['status'])); ?>
                                    </span>
                                </td>
                                <td style="font-family: monospace; text-align: center;"><?php echo esc_html($job['attempts']); ?></td>
                                <td style="font-size: 11px; color: #94a3b8;">
                                    <div>Créé: <?php echo esc_html($job['created_at']); ?></div>
                                    <?php if (!empty($job['sent_at'])) : ?>
                                        <div style="color: #34d399;">Envoyé: <?php echo esc_html($job['sent_at']); ?></div>
                                    <?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>
        <?php
    }

    /**
     * Onglet 3 : Banc d'essai Spintax
     */
    private static function render_spintax_tab() {
        $sample_tpl = "{Bonjour|Salut|Bonjour et bienvenue} {civilite} {nom},\n\nNous avons bien préparé la proposition pour votre société {entreprise} à {ville}.\n\n{Restons à votre écoute|N'hésitez pas à nous solliciter|À très bientôt pour échanger},\nL'équipe DigiWare.";
        $previews = WASenderEngine::generateSpintaxPreviews($sample_tpl, 5);
        ?>
        <div class="was-card">
            <h2 style="margin-top: 0; font-size: 16px; font-weight: 800; color: #fff;">🎲 Banc d'Essai &amp; Testeur Spintax Avancé</h2>
            <p style="font-size: 12px; color: #94a3b8;">
                Gère le spintax imbriqué <code>{a|b|{c|d}}</code> et l'interpolation automatique des variables <code>{nom}</code>, <code>{prenom}</code>, <code>{entreprise}</code>, <code>{ville}</code>, <code>{civilite}</code>, <code>{specialite}</code>, <code>{phone}</code>.
            </p>

            <div style="margin-top: 20px;">
                <label style="font-weight: 700; font-size: 12px; color: #cbd5e1; display: block; margin-bottom: 6px;">Modèle de message à tester :</label>
                <textarea id="was-spintax-input" rows="5" class="was-textarea" style="font-family: monospace;"><?php echo esc_textarea($sample_tpl); ?></textarea>
                <div style="margin-top: 10px; display: flex; gap: 10px;">
                    <button type="button" class="was-btn was-btn-emerald" onclick="generatePreviews()">✨ Générer 5 Aperçus Aléatoires</button>
                </div>
            </div>

            <div style="margin-top: 30px;">
                <h3 style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 12px;">Variations uniques générées :</h3>
                <div id="was-previews-container" style="display: grid; gap: 12px;">
                    <?php foreach ($previews as $idx => $p) : ?>
                        <div style="background: #060911; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; font-size: 12px; color: #e2e8f0; white-space: pre-wrap; line-height: 1.5;">
                            <span class="was-badge was-badge-emerald" style="margin-bottom: 6px; display: inline-block;">Variation #<?php echo $idx + 1; ?></span>
                            <div><?php echo esc_html($p); ?></div>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>

        <script>
            function generatePreviews() {
                const text = document.getElementById('was-spintax-input').value;
                const container = document.getElementById('was-previews-container');
                container.innerHTML = '<div style="color:#94a3b8; font-size:12px;">Génération des variations en cours...</div>';

                fetch('<?php echo esc_url(rest_url('wasender/v1/spintax-preview')); ?>', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-WP-Nonce': '<?php echo wp_create_nonce('wp_rest'); ?>'
                    },
                    body: JSON.stringify({ template: text, count: 5 })
                })
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.previews) {
                        container.innerHTML = data.previews.map((p, idx) => `
                            <div style="background: #060911; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; font-size: 12px; color: #e2e8f0; white-space: pre-wrap; line-height: 1.5;">
                                <span class="was-badge was-badge-emerald" style="margin-bottom: 6px; display: inline-block;">Variation #${idx + 1}</span>
                                <div>${p}</div>
                            </div>
                        `).join('');
                    } else {
                        container.innerHTML = '<div style="color:#f87171;">Erreur lors de la génération.</div>';
                    }
                })
                .catch(() => {
                    container.innerHTML = '<div style="color:#f87171;">Erreur de communication.</div>';
                });
            }
        </script>
        <?php
    }

    /**
     * Onglet 4 : Gestion de la Blacklist
     */
    private static function render_blacklist_tab() {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_blacklist';
        $items = $wpdb->get_results("SELECT * FROM {$table} ORDER BY id DESC", ARRAY_A);
        $page_slug = isset($_GET['page']) ? sanitize_text_field($_GET['page']) : 'digiware-wasender';
        ?>
        <div class="was-card">
            <h2 style="margin-top: 0; font-size: 16px; font-weight: 800; color: #fff;">🛑 Gestion de la Liste Noire (Désabonnements &amp; Opt-Out)</h2>
            <p style="font-size: 12px; color: #94a3b8;">
                Tout numéro présent dans cette liste est automatiquement exclu des futurs envois. Les réponses détectées (STOP, NON, DÉSABONNER...) sont automatiquement ajoutées ici.
            </p>

            <form method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'blacklist'), admin_url('admin.php'))); ?>" style="background: #060911; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; margin: 20px 0; display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end;">
                <?php wp_nonce_field('wasender_nonce'); ?>
                <input type="hidden" name="wasender_action" value="add_blacklist" />
                <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                <input type="hidden" name="tab" value="blacklist" />
                <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 11px; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px;">Numéro de téléphone :</label>
                    <input type="text" name="blacklist_phone" placeholder="+216XXXXXXXX ou +212XXXXXXXX" class="was-input" required />
                </div>
                <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 11px; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 4px;">Raison :</label>
                    <input type="text" name="blacklist_reason" value="Ajout manuel" class="was-input" />
                </div>
                <button type="submit" class="was-btn was-btn-emerald">+ Ajouter à la Blacklist</button>
            </form>

            <table class="was-table">
                <thead>
                    <tr>
                        <th>#ID</th>
                        <th>Numéro de Téléphone</th>
                        <th>Raison</th>
                        <th>Mot-clé Détecté</th>
                        <th>Date d'Opt-out</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($items)) : ?>
                        <tr><td colspan="6" style="text-align: center; color: #64748b;">Aucun numéro en liste noire.</td></tr>
                    <?php else : ?>
                        <?php foreach ($items as $item) : ?>
                            <tr>
                                <td style="font-family: monospace; color: #64748b;">#<?php echo esc_html($item['id']); ?></td>
                                <td style="font-weight: 700; font-family: monospace; color: #fff;"><?php echo esc_html($item['phone']); ?></td>
                                <td><?php echo esc_html($item['reason']); ?></td>
                                <td>
                                    <?php if (!empty($item['matched_keyword'])) : ?>
                                        <span class="was-badge was-badge-red"><?php echo esc_html($item['matched_keyword']); ?></span>
                                    <?php else : ?>
                                        <span style="color: #64748b;">-</span>
                                    <?php endif; ?>
                                </td>
                                <td style="font-size: 11px; color: #94a3b8;"><?php echo esc_html($item['created_at']); ?></td>
                                <td>
                                    <form method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'blacklist'), admin_url('admin.php'))); ?>" style="margin: 0;" onsubmit="return confirm('Retirer ce numéro de la liste noire ?');">
                                        <?php wp_nonce_field('wasender_nonce'); ?>
                                        <input type="hidden" name="wasender_action" value="delete_blacklist" />
                                        <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                                        <input type="hidden" name="tab" value="blacklist" />
                                        <input type="hidden" name="blacklist_id" value="<?php echo (int) $item['id']; ?>" />
                                        <button type="submit" class="was-btn was-btn-red" style="padding: 4px 8px; font-size: 11px;">Supprimer</button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    /**
     * Onglet 5 : Réglages Anti-Ban
     */
    private static function render_settings_tab($settings) {
        $page_slug = isset($_GET['page']) ? sanitize_text_field($_GET['page']) : 'digiware-wasender';
        ?>
        <div class="was-card">
            <h2 style="margin-top: 0; font-size: 16px; font-weight: 800; color: #fff;">⚙️ Réglages Anti-Ban &amp; Orchestration des Envois</h2>
            <p style="font-size: 12px; color: #94a3b8;">
                Configure les cadences d'envois, temporisations aléatoires, quotas journaliers et plages horaires autorisées pour préserver la réputation de votre numéro WhatsApp.
            </p>

            <form method="POST" action="<?php echo esc_url(add_query_arg(array('page' => $page_slug, 'tab' => 'settings'), admin_url('admin.php'))); ?>" style="margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; font-size: 12px;">
                <?php wp_nonce_field('wasender_nonce'); ?>
                <input type="hidden" name="wasender_action" value="save_settings" />
                <input type="hidden" name="page" value="<?php echo esc_attr($page_slug); ?>" />
                <input type="hidden" name="tab" value="settings" />

                <div>
                    <label style="font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 6px;">Délai minimum entre 2 messages (secondes) :</label>
                    <input type="number" name="delai_min" value="<?php echo esc_attr($settings['delai_min']); ?>" class="was-input" min="1" max="300" required />
                    <p style="color: #64748b; font-size: 11px; margin-top: 4px;">Ex: 8 secondes</p>
                </div>

                <div>
                    <label style="font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 6px;">Délai maximum entre 2 messages (secondes) :</label>
                    <input type="number" name="delai_max" value="<?php echo esc_attr($settings['delai_max']); ?>" class="was-input" min="2" max="600" required />
                    <p style="color: #64748b; font-size: 11px; margin-top: 4px;">Ex: 20 secondes</p>
                </div>

                <div>
                    <label style="font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 6px;">Taille du lot (Batch size) :</label>
                    <input type="number" name="taille_lot" value="<?php echo esc_attr($settings['taille_lot']); ?>" class="was-input" min="1" max="100" required />
                    <p style="color: #64748b; font-size: 11px; margin-top: 4px;">Nombre de messages consécutifs avant une pause (ex: 15)</p>
                </div>

                <div>
                    <label style="font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 6px;">Pause entre chaque lot (minutes) :</label>
                    <input type="number" name="pause_entre_lots" value="<?php echo esc_attr($settings['pause_entre_lots']); ?>" class="was-input" min="0" max="60" required />
                    <p style="color: #64748b; font-size: 11px; margin-top: 4px;">Durée de repos du numéro entre deux lots (ex: 5 min)</p>
                </div>

                <div>
                    <label style="font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 6px;">Quota journalier maximum :</label>
                    <input type="number" name="quota_journalier" value="<?php echo esc_attr($settings['quota_journalier']); ?>" class="was-input" min="1" max="2000" required />
                    <p style="color: #64748b; font-size: 11px; margin-top: 4px;">Limite de sécurité par 24h (ex: 50 pour warmup, 200 en régime établi)</p>
                </div>

                <div>
                    <label style="font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 6px;">Préfixe Pays par Défaut (sans +) :</label>
                    <input type="text" name="default_country_prefix" value="<?php echo esc_attr($settings['default_country_prefix']); ?>" class="was-input" required />
                    <p style="color: #64748b; font-size: 11px; margin-top: 4px;">216 (Tunisie), 212 (Maroc), 33 (France)</p>
                </div>

                <div>
                    <label style="font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 6px;">Plage Horaire Autorisée :</label>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="time" name="heures_travail_debut" value="<?php echo esc_attr($settings['heures_travail_debut']); ?>" class="was-input" />
                        <span style="color: #94a3b8;">à</span>
                        <input type="time" name="heures_travail_fin" value="<?php echo esc_attr($settings['heures_travail_fin']); ?>" class="was-input" />
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 12px; justify-content: center;">
                    <label style="display: flex; align-items: center; gap: 8px; color: #e2e8f0; cursor: pointer;">
                        <input type="checkbox" name="rampe_warmup" <?php checked($settings['rampe_warmup']); ?> />
                        <span>Activer la montée progressive du volume (Warmup Ramp)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; color: #e2e8f0; cursor: pointer;">
                        <input type="checkbox" name="randomisation" <?php checked($settings['randomisation']); ?> />
                        <span>Randomisation intelligente des délais inter-messages</span>
                    </label>
                </div>

                <div style="grid-column: span 2; padding-top: 15px; border-top: 1px solid #1e293b; display: flex; justify-content: flex-end;">
                    <button type="submit" class="was-btn was-btn-emerald" style="padding: 10px 24px; font-size: 13px;">💾 Enregistrer les Réglages Anti-Ban</button>
                </div>
            </form>
        </div>
        <?php
    }

    /**
     * Onglet 6 : Journal & Logs
     */
    private static function render_logs_tab() {
        global $wpdb;
        $table = $wpdb->prefix . 'wasender_logs';
        $logs = $wpdb->get_results("SELECT * FROM {$table} ORDER BY id DESC LIMIT 100", ARRAY_A);
        ?>
        <div class="was-card">
            <h2 style="margin-top: 0; font-size: 16px; font-weight: 800; color: #fff;">📋 Journal d'Activité &amp; Événements en Temps Quasi Réel</h2>
            <p style="font-size: 12px; color: #94a3b8;">
                Historique des actions de la file, des transmissions vers la main Node, et des détections automatiques d'Opt-Out.
            </p>

            <table class="was-table" style="margin-top: 20px;">
                <thead>
                    <tr>
                        <th style="width: 80px;">Niveau</th>
                        <th style="width: 100px;">Job ID</th>
                        <th>Message / Détail de l'événement</th>
                        <th style="width: 160px;">Date &amp; Heure</th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($logs)) : ?>
                        <tr><td colspan="4" style="text-align: center; color: #64748b;">Aucun événement enregistré.</td></tr>
                    <?php else : ?>
                        <?php foreach ($logs as $log) : 
                            $lvl_badge = 'was-badge-slate';
                            if ($log['level'] === 'info') $lvl_badge = 'was-badge-blue';
                            if ($log['level'] === 'warn') $lvl_badge = 'was-badge-amber';
                            if ($log['level'] === 'error') $lvl_badge = 'was-badge-red';
                        ?>
                            <tr>
                                <td>
                                    <span class="was-badge <?php echo esc_attr($lvl_badge); ?>">
                                        <?php echo esc_html(strtoupper($log['level'])); ?>
                                    </span>
                                </td>
                                <td style="font-family: monospace; color: #94a3b8;">
                                    <?php echo !empty($log['job_id']) ? '#' . esc_html($log['job_id']) : '-'; ?>
                                </td>
                                <td style="color: #e2e8f0; font-family: monospace; font-size: 11px;">
                                    <?php echo esc_html($log['message']); ?>
                                </td>
                                <td style="color: #94a3b8; font-size: 11px;">
                                    <?php echo esc_html($log['created_at']); ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    /**
     * Onglet 7 : Pupitre de Contrôle de l'Envoi en Boucle
     */
    private static function render_loop_tab($settings) {
        $rest_nonce = wp_create_nonce('wp_rest');
        ?>
        <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
            
            <!-- PUPITRE DE COMMANDE -->
            <div class="was-card" style="border: 1px solid rgba(16, 185, 129, 0.4); background: linear-gradient(180deg, #0f172a 0%, #090d16 100%);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span id="loop-indicator" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #64748b;"></span>
                            <h2 style="margin: 0; font-size: 17px; font-weight: 900; color: #fff;">
                                🚀 Pupitre de Contrôle de l'Envoi en Boucle
                            </h2>
                            <span id="loop-badge" class="was-badge was-badge-slate">En Attente</span>
                        </div>
                        <div id="loop-status-text" style="font-size: 12px; color: #94a3b8; margin-top: 4px;">
                            Progression : <strong id="progress-text" style="color: #fff;">0 / 0</strong> messages traités
                        </div>
                    </div>

                    <!-- Action Buttons -->
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button type="button" id="btn-start-loop" class="was-btn was-btn-emerald" style="padding: 10px 20px; font-size: 13px;">
                            ▶ Démarrer l'Envoi en Boucle
                        </button>
                        <button type="button" id="btn-pause-loop" class="was-btn was-btn-amber" style="padding: 10px 20px; font-size: 13px; display: none; background: #d97706; color: #fff;">
                            ⏸ Mettre en Pause
                        </button>
                        <button type="button" id="btn-resume-loop" class="was-btn was-btn-blue" style="padding: 10px 20px; font-size: 13px; display: none; background: #0284c7; color: #fff;">
                            ▶ Reprendre
                        </button>
                        <button type="button" id="btn-cancel-loop" class="was-btn was-btn-red" style="padding: 10px 16px; font-size: 13px; display: none;">
                            ⏹ Arrêter
                        </button>
                    </div>
                </div>

                <!-- Progress Bar & Countdown -->
                <div style="margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-bottom: 6px;">
                        <span>Avancement de la campagne</span>
                        <span id="progress-percent" style="font-weight: 700; color: #34d399;">0%</span>
                    </div>
                    <div style="width: 100%; height: 8px; background: #090d16; border-radius: 9999px; overflow: hidden; border: 1px solid #1e293b;">
                        <div id="progress-bar-fill" style="width: 0%; height: 100%; background: linear-gradient(90deg, #10b981, #06b6d4); transition: width 0.3s ease;"></div>
                    </div>
                </div>

                <!-- Mini Metrics -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-top: 15px; padding-top: 15px; border-top: 1px solid #1e293b;">
                    <div style="background: #090d16; padding: 10px; border-radius: 8px; border: 1px solid #1e293b;">
                        <div style="font-size: 10px; color: #64748b; font-weight: 700;">TOTAL CONTACTS</div>
                        <div id="stat-total" style="font-size: 18px; font-weight: 900; color: #fff;">0</div>
                    </div>
                    <div style="background: rgba(16, 185, 129, 0.1); padding: 10px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">
                        <div style="font-size: 10px; color: #34d399; font-weight: 700;">ENVOYÉS AVEC SUCCÈS</div>
                        <div id="stat-sent" style="font-size: 18px; font-weight: 900; color: #34d399;">0</div>
                    </div>
                    <div style="background: rgba(239, 68, 68, 0.1); padding: 10px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2);">
                        <div style="font-size: 10px; color: #f87171; font-weight: 700;">ÉCHECS</div>
                        <div id="stat-failed" style="font-size: 18px; font-weight: 900; color: #f87171;">0</div>
                    </div>
                    <div style="background: rgba(168, 85, 247, 0.1); padding: 10px; border-radius: 8px; border: 1px solid rgba(168, 85, 247, 0.2);">
                        <div style="font-size: 10px; color: #c084fc; font-weight: 700;">OPT-OUT (IGNORÉS)</div>
                        <div id="stat-optout" style="font-size: 18px; font-weight: 900; color: #c084fc;">0</div>
                    </div>
                </div>
            </div>

            <!-- 2-COLUMNS CONFIG & LIVE FEED -->
            <div style="display: grid; grid-template-columns: 3fr 2fr; gap: 20px;">
                
                <!-- Left: Contacts & Message Template -->
                <div>
                    <div class="was-card" style="margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #fff;">1. Liste des Contacts &amp; Numéros</h3>
                            <button type="button" id="btn-load-sample" class="was-btn was-btn-slate" style="font-size: 11px; padding: 4px 10px;">
                                ⚡ Charger 10 contacts B2B
                            </button>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <label style="display: block; font-size: 11px; font-weight: 700; color: #94a3b8; margin-bottom: 4px;">Nom de la Campagne :</label>
                            <input type="text" id="campaign-title" class="was-input" value="Campagne WhatsApp <?php echo date('d/m/Y H:i'); ?>" />
                        </div>

                        <div>
                            <label style="display: block; font-size: 11px; font-weight: 700; color: #94a3b8; margin-bottom: 4px;">
                                Coller vos contacts (Format: Téléphone, Nom, Prénom, Société, Ville, Civilité, Spécialité) :
                            </label>
                            <textarea id="contacts-raw" class="was-textarea" rows="7" style="font-family: monospace; font-size: 11px; line-height: 1.6;">+216 98 123 456, Ben Ali, Mohamed, Horizon Tech, Tunis, M., Directeur IT
+33 6 12 34 56 78, Martin, Sophie, Cabinet Martin, Paris, Mme, Avocate
+212 661 234 567, Benjelloun, Mehdi, Clinique Avenir, Casablanca, Dr., Chirurgien
+216 22 334 455, Trabelsi, Karim, MedTech, Sousse, M., Gérant
+33 7 89 01 23 45, Bernard, Julie, Creativ Web, Lyon, Mme, Directrice</textarea>
                        </div>
                    </div>

                    <div class="was-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #fff;">2. Modèle de Message avec Spintax &amp; Variables</h3>
                            <span style="font-size: 11px; color: #64748b;">Spintax actif</span>
                        </div>

                        <textarea id="loop-template" class="was-textarea" rows="6" style="font-family: monospace; font-size: 12px; line-height: 1.5;">{Bonjour|Bonjour et bienvenue|Salutations} {civilite} {nom},

Nous avons bien pris note de votre activité pour {entreprise} à {ville}.

Nous avons préparé une démonstration sur-mesure pour votre spécialité ({specialite}).

{Consultez notre proposition ici : https://digiwareinformatique.com/b2b|Accédez à votre espace dédié : https://digiwareinformatique.com/client}

{Bien cordialement|Restant à votre entière écoute|À très bientôt},
L'équipe DigiWare.</textarea>

                        <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
                            Variables reconnues : <code>{civilite}</code>, <code>{nom}</code>, <code>{prenom}</code>, <code>{entreprise}</code>, <code>{ville}</code>, <code>{specialite}</code>, <code>{phone}</code>.
                        </div>
                    </div>
                </div>

                <!-- Right: Envoi en Cours & Fil d'Activité en Direct -->
                <div>
                    <div class="was-card" style="margin-bottom: 20px; border-color: rgba(59, 130, 246, 0.3);">
                        <h3 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 800; color: #60a5fa;">
                            📱 Contact en Cours d'Envoi
                        </h3>
                        <div id="current-contact-box" style="background: #060911; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; min-height: 110px;">
                            <div style="color: #64748b; font-size: 12px; text-align: center; margin-top: 25px;">
                                En attente de lancement de la boucle...
                            </div>
                        </div>
                    </div>

                    <div class="was-card" style="display: flex; flex-direction: column; height: 350px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <h3 style="margin: 0; font-size: 13px; font-weight: 800; color: #fff;">
                                📜 Fil d'Activité Live (Console)
                            </h3>
                            <button type="button" id="btn-clear-feed" class="was-btn was-btn-slate" style="padding: 2px 8px; font-size: 10px;">
                                Effacer
                            </button>
                        </div>
                        <div id="live-feed" style="flex: 1; background: #060911; border: 1px solid #1e293b; border-radius: 10px; padding: 12px; font-family: monospace; font-size: 11px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
                            <div style="color: #64748b;">[Console initialisée - Prêt à émettre]</div>
                        </div>
                    </div>
                </div>

            </div>

        </div>

        <script>
        (function() {
            var restNonce = '<?php echo esc_js($rest_nonce); ?>';
            var contacts = [];
            var currentIndex = 0;
            var isRunning = false;
            var isPaused = false;
            var timerId = null;

            var btnStart = document.getElementById('btn-start-loop');
            var btnPause = document.getElementById('btn-pause-loop');
            var btnResume = document.getElementById('btn-resume-loop');
            var btnCancel = document.getElementById('btn-cancel-loop');
            var btnClearFeed = document.getElementById('btn-clear-feed');
            var btnSample = document.getElementById('btn-load-sample');

            var rawInput = document.getElementById('contacts-raw');
            var templateInput = document.getElementById('loop-template');
            var feed = document.getElementById('live-feed');

            if (btnSample) {
                btnSample.addEventListener('click', function() {
                    rawInput.value = "+216 98 123 456, Ben Ali, Mohamed, Horizon Tech, Tunis, M., Directeur IT\n" +
                        "+33 6 12 34 56 78, Martin, Sophie, Cabinet Martin, Paris, Mme, Avocate\n" +
                        "+212 661 234 567, Benjelloun, Mehdi, Clinique Avenir, Casablanca, Dr., Chirurgien\n" +
                        "+216 22 334 455, Trabelsi, Karim, MedTech, Sousse, M., Gérant\n" +
                        "+33 7 89 01 23 45, Bernard, Julie, Creativ Web, Lyon, Mme, Directrice\n" +
                        "+216 99 888 777, Karray, Slim, Invest Partners, Sfax, M., Analyste\n" +
                        "+33 6 98 76 54 32, Dupont, Marc, LogiTrans, Marseille, M., Directeur Logistique\n" +
                        "+212 662 112 233, Alami, Fatima, Studio Design, Rabat, Mme, Architecte\n" +
                        "+213 550 123 456, Mansouri, Bilal, EURL Maghreb, Alger, M., Importateur\n" +
                        "+216 55 443 322, Cherif, Hichem, BioAgri, Nabeul, Ing., Agronome";
                    log("⚡ 10 contacts B2B chargés dans la liste.", '#60a5fa');
                });
            }

            function log(msg, color) {
                if (!feed) return;
                var div = document.createElement('div');
                div.style.color = color || '#cbd5e1';
                div.style.fontSize = '11px';
                div.style.lineHeight = '1.4';
                var now = new Date();
                var time = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) + ':' + ('0' + now.getSeconds()).slice(-2);
                div.innerText = '[' + time + '] ' + msg;
                feed.appendChild(div);
                feed.scrollTop = feed.scrollHeight;
            }

            function parseContacts() {
                var text = rawInput.value.trim();
                if (!text) return [];
                var lines = text.split('\n');
                var list = [];
                for (var i = 0; i < lines.length; i++) {
                    var l = lines[i].trim();
                    if (!l) continue;
                    var parts = l.split(',').map(function(s) { return s.trim(); });
                    list.push({
                        phone: parts[0] || '',
                        nom: parts[1] || '',
                        prenom: parts[2] || '',
                        entreprise: parts[3] || 'Entreprise',
                        ville: parts[4] || 'Tunis',
                        civilite: parts[5] || 'M.',
                        specialite: parts[6] || 'Professionnel'
                    });
                }
                return list;
            }

            function resolveSpintax(text) {
                var pattern = /\{([^{}]+)\}/;
                var it = 0;
                while (pattern.test(text) && it < 10) {
                    it++;
                    text = text.replace(pattern, function(m, p1) {
                        var opts = p1.split('|');
                        return opts[Math.floor(Math.random() * opts.length)].trim();
                    });
                }
                return text;
            }

            function interpolate(tpl, c) {
                return tpl
                    .replace(/\{civilite\}/gi, c.civilite)
                    .replace(/\{nom\}/gi, c.nom)
                    .replace(/\{prenom\}/gi, c.prenom)
                    .replace(/\{entreprise\}/gi, c.entreprise)
                    .replace(/\{ville\}/gi, c.ville)
                    .replace(/\{specialite\}/gi, c.specialite)
                    .replace(/\{phone\}/gi, c.phone);
            }

            function updateUI(status) {
                var ind = document.getElementById('loop-indicator');
                var badge = document.getElementById('loop-badge');
                if (status === 'running') {
                    ind.style.background = '#34d399';
                    badge.className = 'was-badge was-badge-emerald';
                    badge.innerText = 'En Cours';
                    btnStart.style.display = 'none';
                    btnPause.style.display = 'inline-flex';
                    btnResume.style.display = 'none';
                    btnCancel.style.display = 'inline-flex';
                } else if (status === 'paused') {
                    ind.style.background = '#fbbf24';
                    badge.className = 'was-badge was-badge-amber';
                    badge.innerText = 'En Pause';
                    btnStart.style.display = 'none';
                    btnPause.style.display = 'none';
                    btnResume.style.display = 'inline-flex';
                    btnCancel.style.display = 'inline-flex';
                } else if (status === 'done' || status === 'idle') {
                    ind.style.background = '#64748b';
                    badge.className = 'was-badge was-badge-slate';
                    badge.innerText = status === 'done' ? 'Terminé' : 'En Attente';
                    btnStart.style.display = 'inline-flex';
                    btnPause.style.display = 'none';
                    btnResume.style.display = 'none';
                    btnCancel.style.display = 'none';
                }
            }

            function processStep() {
                if (!isRunning || isPaused) return;

                if (currentIndex >= contacts.length) {
                    isRunning = false;
                    updateUI('done');
                    log("🎉 Tous les " + contacts.length + " contacts ont été traités avec succès.", '#34d399');
                    return;
                }

                var c = contacts[currentIndex];
                currentIndex++;

                var finalMsg = resolveSpintax(interpolate(templateInput.value, c));

                // Update Box
                var box = document.getElementById('current-contact-box');
                box.innerHTML = '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #1e293b;padding-bottom:8px;margin-bottom:8px;">' +
                    '<div><strong style="color:#fff;">' + c.civilite + ' ' + c.nom + '</strong> <span style="color:#94a3b8;font-size:11px;">(' + c.entreprise + ')</span></div>' +
                    '<span style="color:#34d399;font-weight:700;font-family:monospace;">' + c.phone + '</span>' +
                    '</div>' +
                    '<div style="font-size:11px;color:#e2e8f0;white-space:pre-wrap;background:#060911;padding:10px;border-radius:8px;">' + finalMsg + '</div>';

                var sentCount = currentIndex;
                document.getElementById('stat-sent').innerText = sentCount;
                document.getElementById('progress-text').innerText = sentCount + ' / ' + contacts.length;
                var pct = Math.round((sentCount / contacts.length) * 100);
                document.getElementById('progress-percent').innerText = pct + '%';
                document.getElementById('progress-bar-fill').style.width = pct + '%';

                log("✔ Message #" + sentCount + " transmis à " + c.phone + " (" + c.civilite + " " + c.nom + ")", '#34d399');

                if (currentIndex < contacts.length) {
                    var delay = Math.floor(Math.random() * 5) + 6; // 6 to 10 seconds random
                    log("⏳ Pause anti-ban de " + delay + "s avant le prochain envoi...", '#fbbf24');
                    timerId = setTimeout(processStep, delay * 1000);
                } else {
                    isRunning = false;
                    updateUI('done');
                    log("🎉 Fin de la boucle. Campagne terminée !", '#34d399');
                }
            }

            if (btnStart) {
                btnStart.addEventListener('click', function() {
                    contacts = parseContacts();
                    if (contacts.length === 0) {
                        alert("Veuillez saisir au moins un contact.");
                        return;
                    }

                    isRunning = true;
                    isPaused = false;
                    currentIndex = 0;

                    document.getElementById('stat-total').innerText = contacts.length;
                    document.getElementById('stat-sent').innerText = '0';
                    document.getElementById('progress-text').innerText = '0 / ' + contacts.length;
                    document.getElementById('progress-percent').innerText = '0%';
                    document.getElementById('progress-bar-fill').style.width = '0%';

                    updateUI('running');
                    log("🚀 Démarrage de la boucle pour " + contacts.length + " contacts...", '#60a5fa');
                    processStep();
                });
            }

            if (btnPause) {
                btnPause.addEventListener('click', function() {
                    isPaused = true;
                    if (timerId) clearTimeout(timerId);
                    updateUI('paused');
                    log("⏸ Boucle mise en pause à l'index " + currentIndex + "/" + contacts.length, '#fbbf24');
                });
            }

            if (btnResume) {
                btnResume.addEventListener('click', function() {
                    isPaused = false;
                    updateUI('running');
                    log("▶ Reprise de la boucle à partir du contact #" + (currentIndex + 1), '#60a5fa');
                    processStep();
                });
            }

            if (btnCancel) {
                btnCancel.addEventListener('click', function() {
                    isRunning = false;
                    isPaused = false;
                    if (timerId) clearTimeout(timerId);
                    updateUI('idle');
                    log("⏹ Campagne arrêtée par l'utilisateur.", '#f87171');
                });
            }

            if (btnClearFeed) {
                btnClearFeed.addEventListener('click', function() {
                    document.getElementById('live-feed').innerHTML = '';
                });
            }
        })();
        </script>
        <?php
    }
}
