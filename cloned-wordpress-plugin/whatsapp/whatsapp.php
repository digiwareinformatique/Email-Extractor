<?php
/**
 * Plugin Name: DigiWare WhatsApp Business Center
 * Plugin URI: https://digiwareinformatique.com
 * Description: Centre métier de messagerie WhatsApp pour WordPress : conversations bidirectionnelles en temps réel, orchestration de campagnes multisegments, CRM, et connexion directe au WhatsApp Sender.
 * Version: 2.0.0
 * Author: DigiWare Informatique
 * Author URI: https://digiwareinformatique.com
 * Text Domain: digiware-whatsapp
 * Domain Path: /languages
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * License: GPLv2 or later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('DIGIWARE_WHATSAPP_VERSION', '2.0.0');
define('DIGIWARE_WHATSAPP_FILE', __FILE__);
define('DIGIWARE_WHATSAPP_PATH', plugin_dir_path(__FILE__));
define('DIGIWARE_WHATSAPP_URL', plugin_dir_url(__FILE__));

// Require and register autoloader safely
$autoloader_path = DIGIWARE_WHATSAPP_PATH . 'src/Autoloader.php';
if (file_exists($autoloader_path)) {
    require_once $autoloader_path;
    if (class_exists('\\DigiWare\\WhatsApp\\Autoloader')) {
        \DigiWare\WhatsApp\Autoloader::register(DIGIWARE_WHATSAPP_PATH . 'src/');
    }
}

// Direct requires for robust fallback in all WordPress hosting environments
require_once DIGIWARE_WHATSAPP_PATH . 'src/Core/Installer.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Core/Normalizer.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Tracking/LinkTracker.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Tracking/OmniTrackerBridge.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Preparation/TemplateManager.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Preparation/CrmConnector.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Preparation/MessagePreparator.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Sender/WASenderEngine.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Sender/WASenderQueue.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Sender/WASenderRestApi.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Sender/WASenderAdmin.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Sender/WhatsAppSenderAdapter.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/WordPress/Admin.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/WordPress/RestApi.php';
require_once DIGIWARE_WHATSAPP_PATH . 'src/Core/Plugin.php';

// Activation & Deactivation hooks
register_activation_hook(__FILE__, array('\\DigiWare\\WhatsApp\\Core\\Plugin', 'on_activate'));
register_deactivation_hook(__FILE__, array('\\DigiWare\\WhatsApp\\Core\\Plugin', 'on_deactivate'));

/**
 * Launch plugin
 */
function digiware_whatsapp_init() {
    return \DigiWare\WhatsApp\Core\Plugin::instance();
}
add_action('plugins_loaded', 'digiware_whatsapp_init');
