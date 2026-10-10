/**
 * Business Template & Civility Resolver Engine
 * Formule les salutations professionnelles, évalue les conditions et résout les variables CRM/WooCommerce/LinkCenter
 */
import { CrmContact, MessageTemplate, WcProduct, LinkCenterLink } from '../../src/types/businessCenter';

export interface ResolveContext {
  contact: CrmContact;
  product?: WcProduct;
  link?: LinkCenterLink;
  campaignName?: string;
  orderId?: string;
}

/**
 * Generate respectful, neutral, and accurate salutation
 * Rules:
 * 1. If preferred_salutation is explicitly set on contact, use it.
 * 2. If professional title or civility is 'Maître' or profession contains 'avocat'/'notaire', use 'Bonjour Maître [Nom],'
 * 3. If civility is 'Docteur' or profession contains 'docteur'/'médecin'/'dentiste', use 'Bonjour Docteur [Nom],'
 * 4. If civility is 'Monsieur' and last_name is known, use 'Bonjour Monsieur [Nom],'
 * 5. If civility is 'Madame' and last_name is known, use 'Bonjour Madame [Nom],'
 * 6. Otherwise (neutral, never guess gender): 'Bonjour [Prénom],' or 'Bonjour,'
 */
export function buildRespectfulSalutation(contact: CrmContact): string {
  if (contact.preferred_salutation && contact.preferred_salutation.trim()) {
    return contact.preferred_salutation.trim();
  }

  const civility = contact.civility;
  const lastName = (contact.last_name || '').trim();
  const firstName = (contact.first_name || '').trim();

  // Legal profession / Maître
  if (civility === 'Maître' || (contact.profession && /avocat|notaire|huissier/i.test(contact.profession))) {
    if (lastName) return `Bonjour Maître ${lastName},`;
    if (firstName) return `Bonjour Maître ${firstName},`;
    return 'Bonjour Maître,';
  }

  // Medical profession / Docteur
  if (civility === 'Docteur' || (contact.profession && /docteur|dr|médecin|chirurgien|dentiste/i.test(contact.profession))) {
    if (lastName) return `Bonjour Docteur ${lastName},`;
    if (firstName) return `Bonjour Docteur ${firstName},`;
    return 'Bonjour Docteur,';
  }

  // Explicit civility with last name
  if (civility === 'Monsieur' && lastName) {
    return `Bonjour Monsieur ${lastName},`;
  }
  if (civility === 'Madame' && lastName) {
    return `Bonjour Madame ${lastName},`;
  }

  // Neutral fallback (Never guess gender from name or number!)
  if (firstName && lastName) {
    return `Bonjour ${firstName} ${lastName},`;
  }
  if (firstName) {
    return `Bonjour ${firstName},`;
  }
  if (contact.company_name) {
    return `Bonjour à toute l'équipe de ${contact.company_name},`;
  }

  return 'Bonjour,';
}

/**
 * Resolves template content with all available fields and conditional blocks
 */
export function resolveTemplateMessage(template: MessageTemplate, context: ResolveContext): string {
  let text = template.content;
  const { contact, product, link, campaignName, orderId } = context;

  // 1. Calculate smart salutation
  const salutation = buildRespectfulSalutation(contact);

  // 2. Prepare variables map
  const variablesMap: Record<string, string> = {
    salutation: salutation,
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    full_name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.company_name || 'Cher client',
    company_name: contact.company_name || '',
    profession: contact.profession || contact.professional_title || '',
    job_title: contact.professional_title || contact.profession || '',
    city: contact.city || 'votre région',
    address: contact.address || '',
    sector: contact.sector || '',
    phone: contact.phone,
    product_name: product?.title || 'notre solution logicielle',
    product_price: product ? `${product.sale_price || product.price} TND` : '',
    order_id: orderId || contact.woocommerce_orders[0]?.number || '',
    campaign_name: campaignName || 'Information DigiWare',
    tracking_link: link?.short_url || link?.destination_url || 'https://digiware.tn'
  };

  // 3. Evaluate conditional blocks if defined in template
  if (Array.isArray(template.conditions)) {
    for (const cond of template.conditions) {
      const val = (contact as any)[cond.field] || (variablesMap[cond.field] || '');
      let match = false;
      if (cond.operator === 'filled') {
        match = Boolean(val && String(val).trim().length > 0);
      } else if (cond.operator === 'empty') {
        match = !val || String(val).trim().length === 0;
      } else if (cond.operator === 'equals') {
        match = String(val).toLowerCase() === String(cond.value || '').toLowerCase();
      }

      if (match && cond.output) {
        text = text + '\n' + cond.output;
      }
    }
  }

  // 4. Replace {{variable}} and {variable}
  for (const [key, value] of Object.entries(variablesMap)) {
    const regDouble = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    const regSingle = new RegExp(`\\{\\s*${key}\\s*\\}`, 'gi');
    text = text.replace(regDouble, value).replace(regSingle, value);
  }

  // 5. Clean up any remaining unresolved double curly braces gracefully
  text = text.replace(/\{\{[^}]+\}\}/g, '').trim();

  return text;
}
