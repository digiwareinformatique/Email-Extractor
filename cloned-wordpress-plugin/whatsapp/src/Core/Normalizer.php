<?php
/**
 * Data and phone normalizer for WhatsApp messaging
 *
 * @package DigiWare\WhatsApp\Core
 */

namespace DigiWare\WhatsApp\Core;

if (!defined('ABSPATH')) {
    exit;
}

class Normalizer {

    /**
     * Clean and format phone number for international WhatsApp delivery
     *
     * @param string $phone
     * @param string $default_prefix e.g. '212' for Morocco
     * @return string Normalized phone number with international dial code, no '+' sign, digits only.
     */
    public static function clean_phone($phone, $default_prefix = '212') {
        if (empty($phone)) {
            return '';
        }

        // Strip non-digit characters except leading plus
        $has_plus = strpos(trim($phone), '+') === 0;
        $digits = preg_replace('/\D/', '', $phone);

        if (empty($digits)) {
            return '';
        }

        // If had a leading plus, digits already have the country prefix
        if ($has_plus) {
            return $digits;
        }

        // If starts with 00, remove the 00
        if (strpos($digits, '00') === 0) {
            return substr($digits, 2);
        }

        // If local number starting with 0 (e.g. 0612345678 in Morocco or France)
        if (strpos($digits, '0') === 0 && strlen($digits) === 10) {
            return $default_prefix . substr($digits, 1);
        }

        // If already starts with prefix
        if (strpos($digits, $default_prefix) === 0 && strlen($digits) >= 11) {
            return $digits;
        }

        // If 9 digits (e.g. 612345678), prepend prefix
        if (strlen($digits) === 9 && in_array(substr($digits, 0, 1), array('5', '6', '7', '8'))) {
            return $default_prefix . $digits;
        }

        return $digits;
    }

    /**
     * Validate whether a phone number is plausible for WhatsApp
     *
     * @param string $phone
     * @return bool
     */
    public static function is_valid_phone($phone) {
        $clean = preg_replace('/\D/', '', $phone);
        return strlen($clean) >= 8 && strlen($clean) <= 15;
    }

    /**
     * Mask phone number for display (GDPR / Privacy friendly)
     * e.g. 212612345678 -> 212 6****5678
     *
     * @param string $phone
     * @return string
     */
    public static function mask_phone($phone) {
        $digits = preg_replace('/\D/', '', $phone);
        $len = strlen($digits);
        if ($len <= 6) {
            return '***';
        }
        $prefix = substr($digits, 0, 4);
        $suffix = substr($digits, -3);
        $masked = str_repeat('*', max(3, $len - 7));
        return $prefix . ' ' . $masked . ' ' . $suffix;
    }
}
