<?php
/**
 * PSR-4 compatible autoloader for DigiWare WhatsApp Extension
 *
 * @package DigiWare\WhatsApp
 */

namespace DigiWare\WhatsApp;

if (!defined('ABSPATH')) {
    exit;
}

class Autoloader {

    /**
     * Namespace prefix
     */
    const PREFIX = 'DigiWare\\WhatsApp\\';

    /**
     * Base directory for source files
     * @var string
     */
    private static $base_dir;

    /**
     * Register autoloader
     */
    public static function register($base_dir = null) {
        self::$base_dir = $base_dir ?: __DIR__ . '/';
        spl_autoload_register(array(__CLASS__, 'load'));
    }

    /**
     * Load class file
     *
     * @param string $class
     * @return bool
     */
    public static function load($class) {
        if (strpos($class, self::PREFIX) !== 0) {
            return false;
        }

        $relative = substr($class, strlen(self::PREFIX));
        $file = self::$base_dir . str_replace('\\', '/', $relative) . '.php';

        if (file_exists($file)) {
            require_once $file;
            return true;
        }

        return false;
    }
}
