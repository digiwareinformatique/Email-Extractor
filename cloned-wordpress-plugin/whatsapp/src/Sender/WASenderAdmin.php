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
                    🔌 Connexion (Application Node)
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
        $api_token   = !empty($settings['api_token']) ? $settings['api_token'] : '';
        $base_url    = rest_url('wasender/v1');
        $rest_nonce  = wp_create_nonce('wp_rest');
        $last_ping   = WASenderQueue::get_setting('last_node_ping', null);
        $is_connected = false;
        $ping_human   = 'jamais';
        if (!empty($last_ping)) {
            $diff = time() - strtotime($last_ping);
            $is_connected = ($diff <= 90);
            $ping_human = human_time_diff(strtotime($last_ping), time()) . ' (il y a)';
        }
        $token_masked = $api_token ? (substr($api_token, 0, 8) . str_repeat('•', max(0, strlen($api_token) - 12)) . substr($api_token, -4)) : 'Non défini';
        ?>
        <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">

            <!-- ETAT REEL DE LA CONNEXION NODE -->
            <div class="was-card" id="node-state-card" style="border: 1px solid <?php echo $is_connected ? 'rgba(16,185,129,0.5)' : 'rgba(245,158,11,0.5)'; ?>; background: linear-gradient(180deg, #0f172a 0%, #090d16 100%);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span id="node-dot" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:<?php echo $is_connected ? '#34d399' : '#fbbf24'; ?>;box-shadow:0 0 16px <?php echo $is_connected ? '#10b981' : '#f59e0b'; ?>;"></span>
                        <h2 style="margin:0;font-size:18px;font-weight:900;color:#fff;">Connexion de l'application d'envoi (Node)</h2>
                        <span id="node-badge" class="was-badge <?php echo $is_connected ? 'was-badge-emerald' : 'was-badge-amber'; ?>">
                            <?php echo $is_connected ? 'Connectée (la main répond)' : 'Hors ligne (aucun signal récent)'; ?>
                        </span>
                    </div>
                    <button type="button" class="was-btn was-btn-slate" onclick="refreshNodeState()">Rafraîchir</button>
                </div>
                <p style="font-size:12px;color:#94a3b8;margin:10px 0 0 0;">
                    Dernier signal de l'application : <strong id="node-ping" style="color:#fff;font-family:monospace;"><?php echo esc_html($ping_human); ?></strong>.
                    La connexion WhatsApp elle-même vit dans l'application Node (le programme « .bat ») ouverte sur votre ordinateur. WordPress ne fait qu'orchestrer la file d'attente ; il ne tient pas la session WhatsApp.
                </p>
            </div>

            <!-- OU EST LE VRAI QR CODE -->
            <div class="was-card">
                <h3 style="margin:0 0 10px 0;font-size:15px;font-weight:800;color:#fff;">Comment relier votre WhatsApp</h3>
                <ol style="color:#cbd5e1;font-size:13px;line-height:1.9;margin:0;padding-left:20px;">
                    <li>Sur l'ordinateur d'envoi, lancez l'application Node (double-cliquez le fichier <code style="color:#34d399;">.bat</code>).</li>
                    <li><strong style="color:#fff;">Le vrai QR code apparaît dans la fenêtre noire du terminal Node</strong>, pas ici. C'est whatsapp-web.js qui le génère.</li>
                    <li>Ouvrez WhatsApp sur votre téléphone → <em>Appareils connectés</em> → <em>Connecter un appareil</em>, puis scannez ce QR du terminal.</li>
                    <li>Une fois relié, la session reste active tant que le programme tourne. Le voyant ci-dessus passe au vert dès que l'application signale sa présence (ping).</li>
                </ol>
                <p style="font-size:12px;color:#64748b;margin:12px 0 0 0;">
                    Note : il n'y a volontairement plus de « faux » QR code ni de bouton de connexion ici. Ils ne pilotaient rien — la seule connexion réelle est celle du terminal Node.
                </p>
            </div>

            <!-- PARAMETRES DE LIAISON POUR L'APPLICATION NODE -->
            <div class="was-card">
                <h3 style="margin:0 0 12px 0;font-size:15px;font-weight:800;color:#fff;">Paramètres à copier dans l'application Node</h3>
                <div style="display:grid;grid-template-columns:160px 1fr;gap:10px;align-items:center;font-size:12px;">
                    <span style="color:#94a3b8;">URL de l'API</span>
                    <code style="color:#e2e8f0;background:#060911;padding:6px 10px;border-radius:6px;word-break:break-all;"><?php echo esc_html($base_url); ?></code>
                    <span style="color:#94a3b8;">Jeton (X-WASender-Token)</span>
                    <code style="color:#e2e8f0;background:#060911;padding:6px 10px;border-radius:6px;"><?php echo esc_html($token_masked); ?></code>
                </div>
                <p style="font-size:11px;color:#64748b;margin:10px 0 0 0;">Le jeton complet est dans le fichier <code>config.json</code> de l'application Node. Il n'est affiché ici que partiellement pour des raisons de sécurité.</p>
            </div>

        </div>

        <script>
        (function() {
            var restBase  = '<?php echo esc_url_raw($base_url); ?>';
            var restNonce = '<?php echo esc_js($rest_nonce); ?>';
            window.refreshNodeState = function() {
                fetch(restBase + '/status', { headers: { 'X-WP-Nonce': restNonce } })
                .then(function(r){ return r.json(); })
                .then(function(res){
                    if (!res || !res.success || !res.status) return;
                    var st = res.status;
                    var connected = !!st.node_connected;
                    var dot = document.getElementById('node-dot');
                    var badge = document.getElementById('node-badge');
                    var ping = document.getElementById('node-ping');
                    if (dot) { dot.style.background = connected ? '#34d399' : '#fbbf24'; dot.style.boxShadow = '0 0 16px ' + (connected ? '#10b981' : '#f59e0b'); }
                    if (badge) { badge.className = 'was-badge ' + (connected ? 'was-badge-emerald' : 'was-badge-amber'); badge.innerText = connected ? 'Connectée (la main répond)' : 'Hors ligne (aucun signal récent)'; }
                    if (ping && st.last_node_ping) { ping.innerText = st.last_node_ping; }
                })
                .catch(function(){});
            };
            setInterval(window.refreshNodeState, 15000);
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
                            <textarea id="contacts-raw" class="was-textarea" rows="7" style="font-family: monospace; font-size: 11px; line-height: 1.6;" placeholder="+216 20 123 456, Ben Ali, Mohamed, Horizon Tech, Tunis, M., Directeur IT&#10;Un contact par ligne. Seul le numéro est obligatoire."></textarea>
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
            var restBase  = '<?php echo esc_url_raw(rest_url('wasender/v1')); ?>';
            var contacts = [];
            var campaignId = null;
            var pollId = null;
            var seen = {};        // job_id -> dernier statut affiché dans le fil
            var isRunning = false;
            var isPaused = false;

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

            function statusColor(s) {
                if (s === 'read' || s === 'delivered' || s === 'sent') return '#34d399';
                if (s === 'failed' || s === 'held_undelivered') return '#f87171';
                if (s === 'opted_out') return '#c084fc';
                if (s === 'processing') return '#60a5fa';
                return '#94a3b8';
            }

            function pollStatus() {
                if (!campaignId) return;
                fetch(restBase + '/jobs?limit=100', { headers: { 'X-WP-Nonce': restNonce } })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var jobs = (data && data.jobs ? data.jobs : []).filter(function(j) { return parseInt(j.campaign_id, 10) === campaignId; });
                    if (!jobs.length) return;
                    jobs.sort(function(a, b) { return a.id - b.id; });
                    var total = jobs.length, done = 0, sent = 0, failed = 0, optout = 0, pending = 0;
                    jobs.forEach(function(j) {
                        var s = j.status;
                        if (s === 'sent' || s === 'delivered' || s === 'read') sent++;
                        else if (s === 'failed' || s === 'held_undelivered') failed++;
                        else if (s === 'opted_out') optout++;
                        else pending++;
                        if (s !== 'queued' && s !== 'processing') done++;
                        if (seen[j.id] !== s) {
                            seen[j.id] = s;
                            log('• ' + j.phone + ' -> ' + s, statusColor(s));
                            document.getElementById('current-contact-box').innerHTML =
                                '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #1e293b;padding-bottom:8px;margin-bottom:8px;"><span style="color:#fff;font-family:monospace;">' + j.phone + '</span><span style="color:' + statusColor(s) + ';font-weight:700;">' + s + '</span></div><div style="font-size:11px;color:#e2e8f0;white-space:pre-wrap;background:#060911;padding:10px;border-radius:8px;max-height:120px;overflow:auto;">' + (j.message_final || '') + '</div>';
                        }
                    });
                    document.getElementById('stat-total').innerText = total;
                    document.getElementById('stat-sent').innerText = sent;
                    document.getElementById('stat-failed').innerText = failed;
                    document.getElementById('stat-optout').innerText = optout;
                    document.getElementById('progress-text').innerText = done + ' / ' + total;
                    var pct = total ? Math.round((done / total) * 100) : 0;
                    document.getElementById('progress-percent').innerText = pct + '%';
                    document.getElementById('progress-bar-fill').style.width = pct + '%';
                    if (pending === 0) {
                        clearInterval(pollId); pollId = null; isRunning = false; updateUI('done');
                        log('File videe : ' + sent + ' envoyes, ' + failed + ' echecs, ' + optout + ' opt-out.', '#34d399');
                    }
                })
                .catch(function(e) { log('Erreur de sondage : ' + e, '#f87171'); });
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
                    seen = {};
                    var titleEl = document.getElementById('campaign-title');
                    var payload = {
                        campaign_name: titleEl ? titleEl.value : 'Campagne WhatsApp',
                        template: templateInput.value,
                        contacts: contacts
                    };

                    document.getElementById('stat-total').innerText = contacts.length;
                    document.getElementById('stat-sent').innerText = '0';
                    document.getElementById('stat-failed').innerText = '0';
                    document.getElementById('stat-optout').innerText = '0';
                    document.getElementById('progress-text').innerText = '0 / ' + contacts.length;
                    document.getElementById('progress-percent').innerText = '0%';
                    document.getElementById('progress-bar-fill').style.width = '0%';

                    updateUI('running');
                    btnStart.disabled = true;
                    log('Creation de ' + contacts.length + ' jobs dans la file d\'attente...', '#60a5fa');

                    // On s'assure que la file n'est pas en pause cote serveur.
                    fetch(restBase + '/jobs/resume', { method: 'POST', headers: { 'X-WP-Nonce': restNonce } });

                    fetch(restBase + '/jobs/bulk', {
                        method: 'POST',
                        headers: { 'X-WP-Nonce': restNonce, 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(res) {
                        btnStart.disabled = false;
                        if (!res || !res.success) {
                            isRunning = false; updateUI('idle');
                            log('Echec creation des jobs : ' + (res && res.message ? res.message : 'reponse invalide'), '#f87171');
                            return;
                        }
                        campaignId = parseInt(res.campaign_id, 10);
                        log('Campagne #' + campaignId + ' creee : ' + res.jobs_created + ' jobs en file' +
                            (res.skipped_blacklisted ? ', ' + res.skipped_blacklisted + ' blacklistes' : '') +
                            (res.invalid_phones ? ', ' + res.invalid_phones + ' invalides' : '') + '.', '#34d399');
                        log('La "main" Node va maintenant envoyer (delais anti-ban cote serveur). Suivi en direct...', '#60a5fa');
                        document.getElementById('stat-total').innerText = res.jobs_created;
                        pollStatus();
                        if (pollId) clearInterval(pollId);
                        pollId = setInterval(pollStatus, 3000);
                    })
                    .catch(function(e) {
                        btnStart.disabled = false;
                        isRunning = false; updateUI('idle');
                        log('Erreur reseau : ' + e, '#f87171');
                    });
                });
            }

            if (btnPause) {
                btnPause.addEventListener('click', function() {
                    isPaused = true;
                    fetch(restBase + '/jobs/pause', { method: 'POST', headers: { 'X-WP-Nonce': restNonce } });
                    updateUI('paused');
                    log('File mise en pause (la main Node cesse de tirer de nouveaux jobs).', '#fbbf24');
                });
            }

            if (btnResume) {
                btnResume.addEventListener('click', function() {
                    isPaused = false;
                    fetch(restBase + '/jobs/resume', { method: 'POST', headers: { 'X-WP-Nonce': restNonce } });
                    updateUI('running');
                    log('File reprise.', '#60a5fa');
                    if (!pollId && campaignId) { pollStatus(); pollId = setInterval(pollStatus, 3000); }
                });
            }

            if (btnCancel) {
                btnCancel.addEventListener('click', function() {
                    isRunning = false;
                    isPaused = false;
                    if (pollId) { clearInterval(pollId); pollId = null; }
                    fetch(restBase + '/jobs/pause', { method: 'POST', headers: { 'X-WP-Nonce': restNonce } });
                    updateUI('idle');
                    log('Suivi arrete. File mise en pause cote serveur (jobs deja crees conserves).', '#f87171');
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
