<?php
/**
 * Safe OmniTracker Integration Bridge
 *
 * Integration Contract v1 compliant:
 * - Non-blocking (never throws into the host flow)
 * - Resolves or creates a valid visitor before recording (OmniTracker requires one)
 * - Privacy-safe payload (caller passes hashed/masked identifiers)
 *
 * @package DigiWare\WhatsApp\Tracking
 */

namespace DigiWare\WhatsApp\Tracking;

if (!defined('ABSPATH')) {
    exit;
}

class OmniTrackerBridge {

    public static function is_omnitracker_available() {
        return defined('OMNITRACKER_VERSION') || has_filter('omnitracker_api_v1');
    }

    public static function get_omnitracker_status() {
        if (defined('OMNITRACKER_VERSION')) {
            return 'Connecte (v' . OMNITRACKER_VERSION . ')';
        }
        if (has_filter('omnitracker_api_v1')) {
            return 'Connecte (API V1 Hook)';
        }
        return 'Non detecte (Mode Autonome)';
    }

    /**
     * Resolve a valid OmniTracker visitor id, or create one.
     * Order: explicit context -> current browser cookie visitor -> new "whatsapp" visitor.
     */
    protected static function resolve_visitor_id($api, array $context) {
        $visitor_id = isset($context['visitor_id']) ? trim((string) $context['visitor_id']) : '';
        if ($visitor_id !== '') {
            return $visitor_id;
        }
        try {
            if (method_exists($api, 'current_visitor_id')) {
                $cv = $api->current_visitor_id();
                if (!empty($cv)) {
                    return (string) $cv;
                }
            }
        } catch (\Throwable $e) {
            // ignore, fall through to create
        }
        try {
            if (method_exists($api, 'get_or_create_visitor')) {
                $v = $api->get_or_create_visitor(null, 'unknown', 'whatsapp');
                if (is_array($v) && !empty($v['visitor_id'])) {
                    return (string) $v['visitor_id'];
                }
            }
        } catch (\Throwable $e) {
            // ignore
        }
        return '';
    }

    /**
     * Record an event into OmniTracker (non-blocking).
     */
    public static function record_event($event_type, array $payload = array(), array $context = array()) {
        try {
            if (!self::is_omnitracker_available()) {
                return false;
            }

            $api = apply_filters('omnitracker_api_v1', null);
            if (!is_object($api)) {
                if (has_action('omnitracker_record_event')) {
                    do_action('omnitracker_record_event', array(
                        'event_type'      => sanitize_key($event_type),
                        'source'          => 'whatsapp',
                        'idempotency_key' => isset($context['idempotency_key']) ? sanitize_text_field($context['idempotency_key']) : wp_generate_uuid4(),
                        'payload'         => $payload,
                    ));
                    return true;
                }
                return false;
            }

            $visitor_id = self::resolve_visitor_id($api, $context);
            if ($visitor_id === '') {
                return false; // OmniTracker cannot record without a valid visitor
            }

            // NOTE: do NOT call current_session_id() here — some OmniTracker builds
            // throw on it (undefined find_active_session). session_id is optional.
            $session_id = isset($context['session_id']) ? trim((string) $context['session_id']) : '';

            $event_data = array(
                'event_type'      => sanitize_key($event_type),
                'source'          => 'whatsapp',
                'idempotency_key' => isset($context['idempotency_key']) ? sanitize_text_field($context['idempotency_key']) : wp_generate_uuid4(),
                'visitor_id'      => $visitor_id,
                'session_id'      => $session_id,
                'payload'         => $payload,
            );

            if (method_exists($api, 'record_event')) {
                $result = $api->record_event($event_data);
                return !is_wp_error($result);
            }

            if (has_action('omnitracker_record_event')) {
                do_action('omnitracker_record_event', $event_data);
                return true;
            }

            return false;
        } catch (\Throwable $e) {
            error_log('[whatsapp][omnitracker] record_event skipped: ' . $e->getMessage());
            return false;
        }
    }
}
