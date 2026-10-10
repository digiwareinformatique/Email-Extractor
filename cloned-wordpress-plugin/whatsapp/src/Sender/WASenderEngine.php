<?php
/**
 * Moteur Métier WhatsApp Sender (Spintax, Interpolation, Validation, Opt-out)
 *
 * @package DigiWare\WhatsApp\Sender
 */

namespace DigiWare\WhatsApp\Sender;

if (!defined('ABSPATH')) {
    exit;
}

class WASenderEngine {

    /**
     * Résolution du spintax récursif / imbriqué {a|b|{c|d}}
     *
     * @param string $text Texte avec balises spintax
     * @return string Texte résolu aléatoirement
     */
    public static function resolveSpintax($text) {
        if (!is_string($text) || strpos($text, '{') === false) {
            return (string) $text;
        }

        $pattern = '/\{([^{}]+)\}/';
        $max_iterations = 15;
        $iteration = 0;

        while (preg_match($pattern, $text) && $iteration < $max_iterations) {
            $iteration++;
            $text = preg_replace_callback($pattern, function ($matches) {
                $options = explode('|', $matches[1]);
                $selected = $options[array_rand($options)];
                return trim($selected);
            }, $text);
        }

        return $text;
    }

    /**
     * Interpolation des variables personnalisées (insensible à la casse)
     *
     * Variables supportées :
     * {nom}, {prenom}, {entreprise}, {ville}, {phone}, {civilite}, {specialite}
     * + alias : {first_name}, {last_name}, {company}, {city}
     *
     * @param string $template Modèle de message
     * @param array $meta Données du contact
     * @param string $phone Numéro de téléphone
     * @return string Message avec variables interpolées
     */
    public static function interpolateVariables($template, array $meta = array(), $phone = '') {
        if (!is_string($template)) {
            return '';
        }

        $nom        = !empty($meta['nom']) ? $meta['nom'] : (!empty($meta['last_name']) ? $meta['last_name'] : '');
        $prenom     = !empty($meta['prenom']) ? $meta['prenom'] : (!empty($meta['first_name']) ? $meta['first_name'] : '');
        $entreprise = !empty($meta['entreprise']) ? $meta['entreprise'] : (!empty($meta['company']) ? $meta['company'] : '');
        $ville      = !empty($meta['ville']) ? $meta['ville'] : (!empty($meta['city']) ? $meta['city'] : '');
        $civilite   = !empty($meta['civilite']) ? $meta['civilite'] : (!empty($meta['civility']) ? $meta['civility'] : '');
        $specialite = !empty($meta['specialite']) ? $meta['specialite'] : (!empty($meta['profession']) ? $meta['profession'] : (!empty($meta['job_title']) ? $meta['job_title'] : ''));

        $tel = !empty($phone) ? $phone : (!empty($meta['phone']) ? $meta['phone'] : '');

        $replacements = array(
            '{nom}'         => $nom,
            '{last_name}'   => $nom,
            '{prenom}'      => $prenom,
            '{first_name}'  => $prenom,
            '{entreprise}'  => $entreprise,
            '{company}'     => $entreprise,
            '{ville}'       => $ville,
            '{city}'        => $ville,
            '{phone}'       => $tel,
            '{tel}'         => $tel,
            '{civilite}'    => $civilite,
            '{civility}'    => $civilite,
            '{specialite}'  => $specialite,
            '{profession}'  => $specialite,
        );

        // Insensible à la casse
        foreach ($replacements as $placeholder => $value) {
            $template = preg_replace('/' . preg_quote($placeholder, '/') . '/i', $value, $template);
        }

        return $template;
    }

    /**
     * Traitement complet d'un message : interpolation des variables PUIS résolution du spintax
     *
     * @param string $template Modèle brut
     * @param array $meta Données du contact
     * @param string $phone Numéro de téléphone
     * @return string Message final prêt à l'envoi
     */
    public static function processOutreachMessage($template, array $meta = array(), $phone = '') {
        // 1. Interpolation des variables
        $interpolated = self::interpolateVariables($template, $meta, $phone);

        // 2. Résolution du Spintax
        $final_message = self::resolveSpintax($interpolated);

        return trim($final_message);
    }

    /**
     * Génère N variations uniques d'un template avec un contact d'exemple
     *
     * @param string $template Modèle avec Spintax et variables
     * @param int $n Nombre d'aperçus demandés (défaut 5)
     * @param array|null $custom_sample Contact d'exemple optionnel
     * @return array Liste des N variations générées
     */
    public static function generateSpintaxPreviews($template, $n = 5, $custom_sample = null) {
        $sample = is_array($custom_sample) ? $custom_sample : array(
            'civilite'   => 'Dr.',
            'nom'        => 'Benjelloun',
            'prenom'     => 'Mehdi',
            'entreprise' => 'Clinique de l’Avenir',
            'ville'      => 'Casablanca',
            'specialite' => 'Chirurgien Dentiste',
            'phone'      => '+212661234567',
        );

        $variations = array();
        $attempts = 0;
        $max_attempts = $n * 8;

        while (count($variations) < $n && $attempts < $max_attempts) {
            $attempts++;
            $preview = self::processOutreachMessage($template, $sample, $sample['phone']);
            if (!in_array($preview, $variations, true)) {
                $variations[] = $preview;
            }
        }

        // Si le spintax offre moins de combinaisons que $n, compléter
        while (count($variations) < $n && !empty($variations)) {
            $variations[] = $variations[array_rand($variations)];
        }

        return $variations;
    }

    /**
     * Détection des demandes de désabonnement (Opt-Out / STOP)
     * Support multilingue (Français, Anglais, Arabe phonétique)
     *
     * @param string $message Contenu de la réponse entrante
     * @return array [ 'is_optout' => bool, 'matched_keyword' => string ]
     */
    public static function isOptOut($message) {
        if (!is_string($message) || trim($message) === '') {
            return array('is_optout' => false, 'matched_keyword' => '');
        }

        $clean = trim($message);

        // Mots-clés exacts ou phrases d'opt-out
        $patterns = array(
            '/\b(stop|arret|arr[eê]ter)\b/i'                   => 'STOP',
            '/\b(non merci|pas interess[eé]|pas int[eé]ress[eé]|non)\b/i' => 'PAS_INTERESSE',
            '/\b(d[eé]sabonner|d[eé]sinscrire|d[eé]sinscription|unsubscribe|optout|opt-out)\b/i' => 'DESABONNER',
            '/\b(ne plus [eé]crire|ne m\'[eé]crivez plus|supprimer mon num[eé]ro|bloquer)\b/i' => 'NE_PLUS_ECRIRE',
            '/\b(quit|cancel|remove me)\b/i'                   => 'UNSUBSCRIBE',
        );

        foreach ($patterns as $pattern => $keyword_label) {
            if (preg_match($pattern, $clean, $matches)) {
                return array(
                    'is_optout'       => true,
                    'matched_keyword' => !empty($matches[0]) ? strtoupper($matches[0]) : $keyword_label,
                );
            }
        }

        return array(
            'is_optout'       => false,
            'matched_keyword' => '',
        );
    }

    /**
     * Validation et formatage strict d'un numéro au standard international E.164
     * Gère spécifiquement Tunisie (+216), France (+33), Maroc (+212) et E.164 général
     *
     * @param string $phone Numéro brut
     * @param string $default_country_prefix Préfixe par défaut sans le + (ex: 216 ou 212 ou 33)
     * @return string|false Numéro formaté (+XXXXXXXXXXX) ou false si invalide
     */
    public static function validateAndFormatPhone($phone, $default_country_prefix = '216') {
        if (!is_string($phone)) {
            return false;
        }

        // Nettoyage de tous les caractères non numériques sauf le '+'
        $clean = preg_replace('/[^\d+]/', '', trim($phone));

        if (empty($clean)) {
            return false;
        }

        // Gestion du double zéro international (00)
        if (substr($clean, 0, 2) === '00') {
            $clean = '+' . substr($clean, 2);
        }

        // Déjà au format international avec +
        if (substr($clean, 0, 1) === '+') {
            $digits = substr($clean, 1);
            if (strlen($digits) >= 8 && strlen($digits) <= 15) {
                return '+' . $digits;
            }
            return false;
        }

        // Numéro sans '+'
        $digits = $clean;

        // Tunisie : 8 chiffres (commence par 2, 5, 9, 4, 7)
        if (strlen($digits) === 8 && in_array(substr($digits, 0, 1), array('2', '4', '5', '7', '9'), true)) {
            return '+216' . $digits;
        }

        // France : 10 chiffres commençant par 0 (06, 07)
        if (strlen($digits) === 10 && substr($digits, 0, 1) === '0') {
            return '+33' . substr($digits, 1);
        }

        // Maroc : 10 chiffres commençant par 0 (06, 07, 05)
        if (strlen($digits) === 10 && in_array(substr($digits, 0, 2), array('06', '07', '05'), true)) {
            return '+212' . substr($digits, 1);
        }

        // Déjà précédé par l'indicatif sans le '+' (ex: 216XXXXXXXX, 212XXXXXXXX, 33XXXXXXXX)
        if (strlen($digits) >= 10 && (substr($digits, 0, 3) === '216' || substr($digits, 0, 3) === '212' || substr($digits, 0, 2) === '33')) {
            return '+' . $digits;
        }

        // Utiliser le préfixe par défaut si longueur entre 8 et 9 chiffres
        if (strlen($digits) >= 8 && strlen($digits) <= 9) {
            $prefix = !empty($default_country_prefix) ? $default_country_prefix : '216';
            return '+' . $prefix . ltrim($digits, '0');
        }

        if (strlen($digits) >= 8 && strlen($digits) <= 15) {
            return '+' . $digits;
        }

        return false;
    }
}
