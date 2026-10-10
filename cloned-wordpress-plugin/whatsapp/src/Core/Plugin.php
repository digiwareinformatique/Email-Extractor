<?php
/**
 * Main Plugin Orchestrator for DigiWare WhatsApp Extension
 *
 * @package DigiWare\WhatsApp\Core
 */

namespace DigiWare\WhatsApp\Core;

use DigiWare\WhatsApp\Tracking\LinkTracker;
use DigiWare\WhatsApp\WordPress\Admin;
use DigiWare\WhatsApp\WordPress\RestApi;
use DigiWare\WhatsApp\Sender\WASenderAdmin;
use DigiWare\WhatsApp\Sender\WASenderRestApi;

if (!defined('ABSPATH')) {
    exit;
}

final class Plugin {

    /**
     * Singleton instance
     * @var Plugin|null
     */
    private static $instance = null;

    /**
     * Get singleton
     */
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructor
     */
    private function __construct() {
        $this->init_hooks();
    }

    /**
     * Initialize all plugin components
     */
    private function init_hooks() {
        // Redirection & Tracking listener
        LinkTracker::init();

        // Admin interface
        if (is_admin()) {
            Admin::init();
            WASenderAdmin::init();
        }

        // REST API (Both core DigiWare namespace and autonomous wasender/v1 namespace)
        add_action('rest_api_init', array(RestApi::class, 'register_routes'));
        add_action('rest_api_init', array(WASenderRestApi::class, 'register_routes'));
    }

    /**
     * Plugin activation callback
     */
    public static function on_activate() {
        Installer::install();
    }

    /**
     * Plugin deactivation callback
     */
    public static function on_deactivate() {
        // Safe flush or cache cleanup
    }
}
