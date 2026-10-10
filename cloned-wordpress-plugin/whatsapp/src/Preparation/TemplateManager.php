<?php
/**
 * WhatsApp Template repository and rendering utilities
 *
 * @package DigiWare\WhatsApp\Preparation
 */

namespace DigiWare\WhatsApp\Preparation;

if (!defined('ABSPATH')) {
    exit;
}

class TemplateManager {

    /**
     * Get built-in starter templates for e-commerce and CRM
     *
     * @return array
     */
    public static function get_default_templates() {
        return array(
            'cart_recovery' => array(
                'slug'        => 'cart_recovery',
                'name'        => '🛒 Relance Panier Abandonné',
                'description' => 'Message incitatif avec lien direct de reprise du panier et code avantage.',
                'content'     => "Bonjour {{first_name}} 👋,\n\nVous avez laissé des articles dans votre panier sur DigiWare !\n\nPour vous aider à finaliser votre commande, profitez de votre offre exclusive avec le lien ci-dessous :\n👉 {{link}}\n\nSi vous avez la moindre question, répondez directement à ce message !",
            ),
            'b2b_followup' => array(
                'slug'        => 'b2b_followup',
                'name'        => '💼 Suivi Prospect B2B',
                'description' => 'Message professionnel pour relancer un prospect ou confirmer un devis.',
                'content'     => "Bonjour {{first_name}},\n\nSuite à votre intérêt pour nos solutions informatiques chez {{company}},\nnotre équipe a préparé une proposition sur-mesure pour vous :\n👉 {{link}}\n\nRestons à votre disposition pour planifier un court échange.",
            ),
            'order_confirmation' => array(
                'slug'        => 'order_confirmation',
                'name'        => '📦 Notification Commande & Suivi',
                'description' => 'Confirmation d\'expédition ou préparation de commande avec lien.',
                'content'     => "Bonjour {{first_name}},\n\nVotre commande #{{order_id}} est bien confirmée ! 🎉\n\nVous pouvez suivre l'état d'avancement de votre livraison en temps réel ici :\n👉 {{link}}\n\nMerci pour votre confiance !",
            ),
            'promo_broadcast' => array(
                'slug'        => 'promo_broadcast',
                'name'        => '⚡ Offre Spéciale Flash',
                'description' => 'Campagne promotionnelle directe vers un produit ou catégorie ciblée.',
                'content'     => "Bonjour {{first_name}} ! ✨\n\nDécouvrez nos nouvelles offres exclusives de la semaine :\n🔥 Réductions exceptionnelles disponibles ici :\n👉 {{link}}\n\nOffre limitée dans le temps. À très vite sur DigiWare !",
            ),
        );
    }
}
