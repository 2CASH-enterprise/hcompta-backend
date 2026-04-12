// H-Compta AI — Service Email Brevo
const axios = require('axios');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL    = process.env.BREVO_FROM_EMAIL || 'noreply@hcompta-ai.com';
const FROM_NAME     = process.env.BREVO_FROM_NAME  || 'H-Compta AI';
const APP_URL       = process.env.APP_URL           || 'https://hcompta-ai.com';

// ── Fonction de base ─────────────────────────────────────────
async function envoyerEmail({ to, subject, htmlContent }) {
  if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY non configurée');
  const payload = {
    sender:      { name: FROM_NAME, email: FROM_EMAIL },
    to:          [{ email: to }],
    subject,
    htmlContent,
  };
  const res = await axios.post(BREVO_API_URL, payload, {
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  return res.data;
}

// ── Email de bienvenue PME ────────────────────────────────────
async function envoyerConfirmationInscription({ emailDestinataire, nomPME, nomContact, pays }) {
  const prenom = nomContact ? nomContact.split(' ')[0] : nomPME;
  await envoyerEmail({
    to: emailDestinataire,
    subject: `Bienvenue sur H-Compta AI — ${nomPME}`,
    htmlContent: `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2EDE8">
  <div style="background:#0D2B22;padding:32px 40px">
    <h1 style="color:#fff;margin:0;font-size:22px">H-Compta AI</h1>
    <p style="color:#A7C4B5;margin:6px 0 0;font-size:13px">Comptabilité SYSCOHADA intelligente</p>
  </div>
  <div style="padding:40px">
    <h2 style="color:#0D2B22;margin:0 0 16px">Bienvenue, ${prenom} ! 🎉</h2>
    <p style="color:#2D3A35;line-height:1.7">Votre espace PME <strong>${nomPME}</strong> (${pays}) est créé. Votre période d'essai gratuite de <strong>30 jours</strong> commence maintenant.</p>
    <div style="background:#F2FAF6;border-radius:8px;padding:20px;margin:24px 0">
      <p style="margin:0;color:#0D2B22;font-weight:600">Vos prochaines étapes :</p>
      <ul style="color:#2D3A35;margin:12px 0 0;padding-left:20px;line-height:2">
        <li>Importez vos premières pièces comptables</li>
        <li>Invitez votre expert-comptable</li>
        <li>Consultez votre tableau de bord en temps réel</li>
      </ul>
    </div>
    <a href="${APP_URL}/dashboard_pme_v3.html" style="display:inline-block;background:#0D2B22;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Accéder à mon dashboard →</a>
  </div>
  <div style="padding:20px 40px;background:#F8FAF9;border-top:1px solid #E2EDE8">
    <p style="color:#9DB8AC;font-size:12px;margin:0">H-Compta AI · ${APP_URL} · Support : support@hcompta-ai.com</p>
  </div>
</div>`,
  });
}

// ── Email invitation cabinet expert ──────────────────────────
async function envoyerInvitationCabinet({ emailDestinataire, nomPME, tokenInvitation, expiresAt }) {
  const lienAcceptation = `${APP_URL}/dashboard_expert_comptable_v2.html?token=${tokenInvitation}`;
  const dateExpiration  = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : '7 jours';
  await envoyerEmail({
    to: emailDestinataire,
    subject: `${nomPME} vous invite à rejoindre H-Compta AI`,
    htmlContent: `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2EDE8">
  <div style="background:#0D2B22;padding:32px 40px">
    <h1 style="color:#fff;margin:0;font-size:22px">H-Compta AI</h1>
    <p style="color:#A7C4B5;margin:6px 0 0;font-size:13px">Invitation Cabinet Expert</p>
  </div>
  <div style="padding:40px">
    <h2 style="color:#0D2B22;margin:0 0 16px">Vous avez reçu une invitation 📩</h2>
    <p style="color:#2D3A35;line-height:1.7"><strong>${nomPME}</strong> vous invite à rejoindre leur espace comptable sur H-Compta AI en tant qu'<strong>expert-comptable</strong>.</p>
    <div style="background:#F2FAF6;border-radius:8px;padding:20px;margin:24px 0">
      <p style="margin:0;color:#2D3A35;line-height:1.7">En acceptant, vous aurez accès à :</p>
      <ul style="color:#2D3A35;margin:12px 0 0;padding-left:20px;line-height:2">
        <li>Toutes les pièces comptables de ${nomPME}</li>
        <li>Les rapports Balance, Résultat, Trésorerie</li>
        <li>Les anomalies détectées par l'IA</li>
        <li>L'envoi de rapports mensuels par email</li>
      </ul>
    </div>
    <a href="${lienAcceptation}" style="display:inline-block;background:#0D2B22;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">✅ Accepter l'invitation →</a>
    <p style="color:#9DB8AC;font-size:12px;margin:24px 0 0">Ce lien expire le <strong>${dateExpiration}</strong>. Si vous n'attendiez pas cette invitation, ignorez cet email.</p>
  </div>
  <div style="padding:20px 40px;background:#F8FAF9;border-top:1px solid #E2EDE8">
    <p style="color:#9DB8AC;font-size:12px;margin:0">H-Compta AI · ${APP_URL} · Support : support@hcompta-ai.com</p>
  </div>
</div>`,
  });
}

// ── Email invitation collaborateur PME ───────────────────────
async function envoyerInvitationCollaborateur({ emailDestinataire, nomPME, tokenInvitation, expiresAt }) {
  const lienAcceptation = `${APP_URL}/dashboard_pme_v3.html?token=${tokenInvitation}`;
  const dateExpiration  = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : '7 jours';
  await envoyerEmail({
    to: emailDestinataire,
    subject: `${nomPME} vous invite comme collaborateur sur H-Compta AI`,
    htmlContent: `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2EDE8">
  <div style="background:#0D2B22;padding:32px 40px">
    <h1 style="color:#fff;margin:0;font-size:22px">H-Compta AI</h1>
    <p style="color:#A7C4B5;margin:6px 0 0;font-size:13px">Invitation Collaborateur</p>
  </div>
  <div style="padding:40px">
    <h2 style="color:#0D2B22;margin:0 0 16px">Vous êtes invité(e) ! 🎉</h2>
    <p style="color:#2D3A35;line-height:1.7"><strong>${nomPME}</strong> vous invite à rejoindre leur espace comptable en tant que <strong>collaborateur</strong>.</p>
    <a href="${lienAcceptation}" style="display:inline-block;background:#0D2B22;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-top:16px">✅ Rejoindre l'équipe →</a>
    <p style="color:#9DB8AC;font-size:12px;margin:24px 0 0">Ce lien expire le <strong>${dateExpiration}</strong>.</p>
  </div>
  <div style="padding:20px 40px;background:#F8FAF9;border-top:1px solid #E2EDE8">
    <p style="color:#9DB8AC;font-size:12px;margin:0">H-Compta AI · ${APP_URL}</p>
  </div>
</div>`,
  });
}

// ── Email confirmation paiement CinetPay ─────────────────────
async function envoyerConfirmationPaiement({ emailDestinataire, nomPME, plan, montant, devise, transactionId }) {
  await envoyerEmail({
    to: emailDestinataire,
    subject: `✅ Paiement confirmé — Plan ${plan} H-Compta AI`,
    htmlContent: `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2EDE8">
  <div style="background:#0D2B22;padding:32px 40px">
    <h1 style="color:#fff;margin:0;font-size:22px">H-Compta AI</h1>
    <p style="color:#A7C4B5;margin:6px 0 0;font-size:13px">Confirmation de paiement</p>
  </div>
  <div style="padding:40px">
    <h2 style="color:#0D2B22;margin:0 0 16px">Paiement reçu ✅</h2>
    <p style="color:#2D3A35;line-height:1.7">Merci <strong>${nomPME}</strong> ! Votre abonnement <strong>Plan ${plan}</strong> est maintenant actif.</p>
    <div style="background:#F2FAF6;border:1px solid #B6D9C7;border-radius:8px;padding:20px;margin:24px 0">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="color:#64748B;padding:6px 0">Montant payé</td><td style="text-align:right;font-weight:700;color:#0D2B22">${montant} ${devise}</td></tr>
        <tr><td style="color:#64748B;padding:6px 0">Plan</td><td style="text-align:right;font-weight:700;color:#0D2B22">${plan}</td></tr>
        <tr><td style="color:#64748B;padding:6px 0">Référence</td><td style="text-align:right;font-size:11px;color:#64748B">${transactionId}</td></tr>
      </table>
    </div>
    <a href="${APP_URL}/dashboard_pme_v3.html" style="display:inline-block;background:#0D2B22;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Accéder à mon dashboard →</a>
  </div>
  <div style="padding:20px 40px;background:#F8FAF9;border-top:1px solid #E2EDE8">
    <p style="color:#9DB8AC;font-size:12px;margin:0">H-Compta AI · ${APP_URL} · Support : support@hcompta-ai.com</p>
  </div>
</div>`,
  });
}

// ── Rapport mensuel avec PDF joint ───────────────────────────
async function envoyerRapportMensuel({ emailDestinataire, nomPME, periode, nomExpert, nomCabinet, commentaire, pdfHtml }) {
  if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY non configurée');
  const pdfBase64 = Buffer.from(pdfHtml, 'utf-8').toString('base64');
  const periodeLabel = periode ? new Date(periode + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : periode;
  const payload = {
    sender:      { name: FROM_NAME, email: FROM_EMAIL },
    to:          [{ email: emailDestinataire }],
    subject:     `Rapport comptable ${periodeLabel} — ${nomPME}`,
    htmlContent: `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2EDE8">
  <div style="background:#0D2B22;padding:32px 40px">
    <h1 style="color:#fff;margin:0;font-size:22px">H-Compta AI</h1>
    <p style="color:#A7C4B5;margin:6px 0 0;font-size:13px">Rapport Mensuel — ${periodeLabel}</p>
  </div>
  <div style="padding:40px">
    <h2 style="color:#0D2B22;margin:0 0 16px">Rapport comptable de ${nomPME}</h2>
    <p style="color:#2D3A35;line-height:1.7">Votre expert-comptable <strong>${nomExpert}</strong> (${nomCabinet}) vous adresse le rapport comptable pour la période <strong>${periodeLabel}</strong>.</p>
    ${commentaire ? `<div style="background:#F2FAF6;border-left:4px solid #0D2B22;border-radius:4px;padding:16px 20px;margin:24px 0"><p style="color:#0D2B22;font-weight:600;margin:0 0 8px">Commentaire de l'expert</p><p style="color:#2D3A35;line-height:1.7;margin:0">${commentaire}</p></div>` : ''}
    <p style="color:#64748B;font-size:13px;margin:24px 0 0">📎 Le rapport complet (Balance, Résultat, Trésorerie) est joint à cet email.</p>
  </div>
  <div style="padding:20px 40px;background:#F8FAF9;border-top:1px solid #E2EDE8">
    <p style="color:#9DB8AC;font-size:12px;margin:0">H-Compta AI · ${APP_URL} · Ce rapport a été généré automatiquement.</p>
  </div>
</div>`,
    attachment: [{
      name:    `rapport-${nomPME.replace(/\s/g,'-')}-${periode}.html`,
      content: pdfBase64,
    }],
  };
  await axios.post(BREVO_API_URL, payload, {
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    timeout: 20000,
  });
}

module.exports = {
  envoyerEmail,
  envoyerConfirmationInscription,
  envoyerInvitationCabinet,
  envoyerInvitationCollaborateur,
  envoyerConfirmationPaiement,
  envoyerRapportMensuel,
};
