<?php
/**
 * CRM & Commercial Data Connector
 *
 * Extracts contacts and variables from WordPress, WooCommerce, and manual inputs
 *
 * @package DigiWare\WhatsApp\Preparation
 */

namespace DigiWare\WhatsApp\Preparation;

use DigiWare\WhatsApp\Core\Normalizer;

if (!defined('ABSPATH')) {
    exit;
}

class CrmConnector {

    /**
     * Check if WooCommerce is available
     *
     * @return bool
     */
    public static function has_woocommerce() {
        return class_exists('WooCommerce');
    }

    /**
     * Fetch candidates from WooCommerce Recent Orders
     *
     * @param int $limit
     * @param string $status
     * @return array
     */
    public static function get_woocommerce_order_contacts($limit = 50, $status = 'any') {
        if (!self::has_woocommerce()) {
            return array();
        }

        $args = array(
            'limit'   => $limit,
            'orderby' => 'date',
            'order'   => 'DESC',
            'return'  => 'ids',
        );

        if ($status !== 'any') {
            $args['status'] = $status;
        }

        $order_ids = wc_get_orders($args);
        $contacts = array();

        foreach ($order_ids as $order_id) {
            $order = wc_get_order($order_id);
            if (!$order) continue;

            $phone = $order->get_billing_phone();
            $clean_phone = Normalizer::clean_phone($phone);

            if (empty($clean_phone) || !Normalizer::is_valid_phone($clean_phone)) {
                continue;
            }

            $contacts[] = array(
                'crm_source' => 'woocommerce_order',
                'crm_id'     => (string) $order_id,
                'phone'      => $clean_phone,
                'raw_phone'  => $phone,
                'first_name' => $order->get_billing_first_name() ?: 'Client',
                'last_name'  => $order->get_billing_last_name(),
                'company'    => $order->get_billing_company(),
                'email'      => $order->get_billing_email(),
                'order_id'   => (string) $order_id,
                'order_total'=> $order->get_total(),
            );
        }

        return $contacts;
    }

    /**
     * Fetch registered WordPress users with phone meta
     *
     * @param int $limit
     * @return array
     */
    public static function get_wordpress_user_contacts($limit = 50) {
        $users = get_users(array(
            'number'  => $limit,
            'orderby' => 'registered',
            'order'   => 'DESC',
        ));

        $contacts = array();

        foreach ($users as $user) {
            $phone = get_user_meta($user->ID, 'billing_phone', true);
            if (empty($phone)) {
                $phone = get_user_meta($user->ID, 'phone', true);
            }
            if (empty($phone)) {
                $phone = get_user_meta($user->ID, 'telephone', true);
            }

            $clean_phone = Normalizer::clean_phone($phone);
            if (empty($clean_phone) || !Normalizer::is_valid_phone($clean_phone)) {
                continue;
            }

            $contacts[] = array(
                'crm_source' => 'wp_user',
                'crm_id'     => (string) $user->ID,
                'phone'      => $clean_phone,
                'raw_phone'  => $phone,
                'first_name' => $user->first_name ?: $user->display_name,
                'last_name'  => $user->last_name,
                'company'    => get_user_meta($user->ID, 'billing_company', true),
                'email'      => $user->user_email,
            );
        }

        return $contacts;
    }

    /**
     * Parse raw contact lines or CSV from manual text area
     * Format: phone;first_name;company;target_link
     * Or: phone,name
     *
     * @param string $raw_text
     * @return array
     */
    public static function parse_manual_contacts($raw_text) {
        $lines = preg_split('/[\r\n]+/', trim($raw_text));
        $contacts = array();

        foreach ($lines as $idx => $line) {
            $line = trim($line);
            if (empty($line) || strpos($line, '#') === 0) continue;

            $delimiter = strpos($line, ';') !== false ? ';' : (strpos($line, ',') !== false ? ',' : "\t");
            $parts = array_map('trim', explode($delimiter, $line));

            $phone = isset($parts[0]) ? $parts[0] : '';
            $name  = isset($parts[1]) ? $parts[1] : '';
            $comp  = isset($parts[2]) ? $parts[2] : '';
            $extra = isset($parts[3]) ? $parts[3] : '';

            $clean_phone = Normalizer::clean_phone($phone);
            if (empty($clean_phone) || !Normalizer::is_valid_phone($clean_phone)) {
                continue;
            }

            $contacts[] = array(
                'crm_source' => 'manual',
                'crm_id'     => 'manual_' . ($idx + 1),
                'phone'      => $clean_phone,
                'raw_phone'  => $phone,
                'first_name' => !empty($name) ? $name : 'Client',
                'last_name'  => '',
                'company'    => $comp,
                'custom_var' => $extra,
            );
        }

        return $contacts;
    }
}
