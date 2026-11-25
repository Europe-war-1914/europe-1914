import type { IncomingMessage, ServerResponse } from 'node:http';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePriceId = process.env.STRIPE_PRICE_ID;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const frontendUrl = process.env.FRONTEND_URL ?? 'https://europe-1914.vercel.app';

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
  });
  res.end(JSON.stringify(payload));
}

/**
 * Gère les routes /api/create-checkout-session et /api/stripe-webhook.
 * Retourne true si la requête a été traitée, false sinon.
 */
export async function handleStripeRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url?.split('?')[0] ?? '';

  if (url !== '/api/create-checkout-session' && url !== '/api/stripe-webhook') {
    return false;
  }

  // Pré-requête CORS (navigateur)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
    });
    res.end();
    return true;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Méthode non autorisée.' });
    return true;
  }

  // 1. Webhook Stripe (appelé par Stripe après un paiement réussi)
  if (url === '/api/stripe-webhook') {
    if (!stripe || !stripeWebhookSecret || !supabaseAdmin) {
      sendJson(res, 500, { error: 'Stripe ou Supabase non configuré.' });
      return true;
    }

    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
      sendJson(res, 400, { error: 'Signature Stripe manquante.' });
      return true;
    }

    let event: Stripe.Event;
    try {
      const rawBody = await readRawBody(req);
      event = stripe.webhooks.constructEvent(rawBody, sig, stripeWebhookSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur signature';
      console.error('Webhook Stripe invalide:', msg);
      sendJson(res, 400, { error: `Webhook Error: ${msg}` });
      return true;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;

      if (userId) {
        const { error } = await supabaseAdmin
          .from('profiles')
          .update({
            is_commander: true,
            unlocked_themes: ['vintage', 'night', 'tactical'],
          })
          .eq('id', userId);

        if (error) {
          console.error('Erreur mise à jour Supabase après paiement:', error);
          sendJson(res, 500, { error: 'Erreur base de données.' });
          return true;
        }
        console.log(`✅ Pack Commandant activé pour l'utilisateur ${userId}`);
      }
    }

    sendJson(res, 200, { received: true });
    return true;
  }

  // 2. Création de la session de paiement Stripe Checkout
  if (url === '/api/create-checkout-session') {
    if (!stripe || !stripePriceId) {
      sendJson(res, 500, { error: 'Stripe non configuré sur le serveur.' });
      return true;
    }

    try {
      const rawBody = await readRawBody(req);
      const { userId, email } = JSON.parse(rawBody.toString('utf8')) as {
        userId?: string;
        email?: string;
      };

      if (!userId) {
        sendJson(res, 400, { error: 'Identifiant utilisateur manquant.' });
        return true;
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: stripePriceId, quantity: 1 }],
        customer_email: email || undefined,
        metadata: { userId },
        success_url: `${frontendUrl}/?payment=success`,
        cancel_url: `${frontendUrl}/?payment=cancelled`,
      });

      sendJson(res, 200, { url: session.url });
    } catch (err) {
      console.error('Erreur création session Stripe:', err);
      sendJson(res, 500, { error: 'Impossible de créer la session de paiement.' });
    }
    return true;
  }

  return false;
}