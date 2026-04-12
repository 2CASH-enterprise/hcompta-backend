// H-Compta AI — Service Email via Brevo (ex-Sendinblue)
// Fonctions : envoyerEmail, envoyerConfirmationInscription,
//             envoyerInvitationCabinet, envoyerInvitationCollaborateur,
//             envoyerRapportMensuel, envoyerConfirmationPaiement

const axios = require('axios');

// ─── Config ────────────────────────────────────────────────────
const BREVO_API_URL  = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL     = process.env.BREVO_FROM_EMAIL  || 'noreply@hcompta-ai.com';
const FROM_NAME      = process.env.BREVO_FROM_NAME   || 'H-Compta AI';
const APP_URL        = process.env.APP_URL            || 'https://hcompta-ai.com';

// ─── Couleurs & styles partagés ────────────────────────────────
const VERT_FONCE  = '#0D2B22';
const VERT_CLAIR  = '#1A7A4E';
const VERT_BG     = '#F2FAF6';
const TEXTE       = '#2D3A35';
const TEXTE_LIGHT = '#9DB8AC';

// ─── Helper interne : envoi brut via Brevo API ─────────────────
async function envoyerEmail({ to, subject, htmlContent, attachments = [] }) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY non configurée');
  }

  const payload = {
    sender:  { email: FROM_EMAIL, name: FROM_NAME },
    to:      [{ email: to }],
    subject,
    htmlContent,
  };

  if (attachments.length > 0) {
    payload.attachment = attachments; // [{ name, content (base64) }]
  }

  const response = await axios.post(BREVO_API_URL, payload, {
    headers: {
      'api-key':      process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  return response.data;
}

// ─── 1. Confirmation d'inscription PME ────────────────────────
async function envoyerConfirmationInscription({ emailDestinataire, nomPME, nomContact, pays }) {
  const prenom = nomContact ? nomContact.split(' ')[0] : nomPME;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <!-- HEADER -->
        <tr><td style="background:${VERT_FONCE};padding:32px 40px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff;letter-spacing:1px">H-Compta <span style="color:#4ADE80">AI</span></div>
          <div style="color:#A7F3D0;font-size:13px;margin-top:6px">Comptabilité intelligente pour l'Afrique</div>
        </td></tr>
        <!-- CORPS -->
        <tr><td style="padding:40px">
          <h2 style="color:${VERT_FONCE};margin:0 0 16px">Bienvenue, ${prenom} ! 🎉</h2>
          <p style="color:${TEXTE};line-height:1.6;margin:0 0 20px">
            Votre compte <strong>${nomPME}</strong> a été créé avec succès. 
            Vous bénéficiez d'une <strong>période d'essai gratuite de 30 jours</strong> pour explorer toutes les fonctionnalités de H-Compta AI.
          </p>

          <!-- KPI ESSAI -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${VERT_BG};border-radius:8px;margin:24px 0">
            <tr>
              <td style="padding:20px;text-align:center;border-right:1px solid #D1FAE5">
                <div style="font-size:28px;font-weight:700;color:${VERT_CLAIR}">30</div>
                <div style="font-size:12px;color:${TEXTE_LIGHT};margin-top:4px">jours d'essai</div>
              </td>
              <td style="padding:20px;text-align:center;border-right:1px solid #D1FAE5">
                <div style="font-size:28px;font-weight:700;color:${VERT_CLAIR}">∞</div>
                <div style="font-size:12px;color:${TEXTE_LIGHT};margin-top:4px">pièces importées</div>
              </td>
              <td style="padding:20px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:${VERT_CLAIR}">IA</div>
                <div style="font-size:12px;color:${TEXTE_LIGHT};margin-top:4px">Mariah activée</div>
              </td>
            </tr>
          </table>

          <p style="color:${TEXTE};line-height:1.6;margin:0 0 28px">
            Commencez dès maintenant en important vos premières pièces comptables. 
            Notre IA Mariah les analyse automatiquement selon le plan SYSCOHADA.
          </p>

          <!-- CTA -->
          <div style="text-align:center;margin:32px 0">
            <a href="${APP_URL}/dashboard_pme_v3.html" 
               style="background:${VERT_CLAIR};color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">
              Accéder à mon dashboard →
            </a>
          </div>

          <hr style="border:none;border-top:1px solid #E5E7EB;margin:32px 0">
          <p style="color:${TEXTE_LIGHT};font-size:12px;line-height:1.6;margin:0">
            Vous recevez cet email car vous venez de créer un compte H-Compta AI pour ${nomPME} (${pays}).
            Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.
          </p>
        </td></tr>
        <!-- FOOTER -->
        <tr><td style="background:${VERT_FONCE};padding:20px 40px;text-align:center">
          <p style="color:#A7F3D0;font-size:12px;margin:0">
            © ${new Date().getFullYear()} H-Compta AI · 
            <a href="${APP_URL}" style="color:#4ADE80;text-decoration:none">hcompta-ai.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return envoyerEmail({
    to:          emailDestinataire,
    subject:     `Bienvenue sur H-Compta AI — Votre essai de 30 jours commence !`,
    htmlContent: html,
  });
}

// ─── 2. Invitation Expert-Comptable (Cabinet) ─────────────────
async function envoyerInvitationCabinet({ emailDestinataire, nomPME, tokenInvitation, expiresAt }) {
  const lienAcceptation = `${APP_URL}/dashboard_expert_comptable_v2.html?invite=${tokenInvitation}`;
  const dateExpiration  = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : '7 jours';

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:${VERT_FONCE};padding:32px 40px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff">H-Compta <span style="color:#4ADE80">AI</span></div>
          <div style="color:#A7F3D0;font-size:13px;margin-top:6px">Invitation Expert-Comptable</div>
        </td></tr>
        <tr><td style="padding:40px">
          <h2 style="color:${VERT_FONCE};margin:0 0 16px">Vous êtes invité comme expert-comptable 📋</h2>
          <p style="color:${TEXTE};line-height:1.6;margin:0 0 20px">
            La PME <strong>${nomPME}</strong> vous invite à rejoindre son espace comptable sur H-Compta AI 
            en tant qu'<strong>expert-comptable</strong>.
          </p>
          <p style="color:${TEXTE};line-height:1.6;margin:0 0 28px">
            En acceptant, vous aurez accès à leur tableau de bord, leurs pièces comptables, 
            leurs rapports financiers et pourrez valider les écritures générées par l'IA.
          </p>

          <div style="background:${VERT_BG};border-left:4px solid ${VERT_CLAIR};padding:16px 20px;border-radius:0 8px 8px 0;margin:24px 0">
            <strong style="color:${VERT_FONCE}">PME concernée :</strong>
            <span style="color:${TEXTE};margin-left:8px">${nomPME}</span><br>
            <strong style="color:${VERT_FONCE}">Expiration :</strong>
            <span style="color:${TEXTE};margin-left:8px">${dateExpiration}</span>
          </div>

          <div style="text-align:center;margin:32px 0">
            <a href="${lienAcceptation}" 
               style="background:${VERT_CLAIR};color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">
              Accepter l'invitation →
            </a>
          </div>

          <p style="color:${TEXTE_LIGHT};font-size:12px;line-height:1.6;margin:16px 0 0">
            Si vous ne souhaitez pas accepter cette invitation, ignorez simplement cet email. 
            Le lien expirera automatiquement le ${dateExpiration}.
          </p>
        </td></tr>
        <tr><td style="background:${VERT_FONCE};padding:20px 40px;text-align:center">
          <p style="color:#A7F3D0;font-size:12px;margin:0">© ${new Date().getFullYear()} H-Compta AI · <a href="${APP_URL}" style="color:#4ADE80;text-decoration:none">hcompta-ai.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return envoyerEmail({
    to:          emailDestinataire,
    subject:     `${nomPME} vous invite comme expert-comptable sur H-Compta AI`,
    htmlContent: html,
  });
}

// ─── 3. Invitation Collaborateur PME ──────────────────────────
async function envoyerInvitationCollaborateur({ emailDestinataire, nomPME, tokenInvitation, expiresAt }) {
  const lienAcceptation = `${APP_URL}/dashboard_pme_v3.html?invite=${tokenInvitation}`;
  const dateExpiration  = expiresAt ? new Date(expiresAt).toLocaleDateString('fr-FR') : '7 jours';

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:${VERT_FONCE};padding:32px 40px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff">H-Compta <span style="color:#4ADE80">AI</span></div>
          <div style="color:#A7F3D0;font-size:13px;margin-top:6px">Invitation Collaborateur</div>
        </td></tr>
        <tr><td style="padding:40px">
          <h2 style="color:${VERT_FONCE};margin:0 0 16px">Vous êtes invité à rejoindre ${nomPME} 👋</h2>
          <p style="color:${TEXTE};line-height:1.6;margin:0 0 20px">
            <strong>${nomPME}</strong> vous invite à rejoindre leur espace comptable sur H-Compta AI 
            en tant que <strong>collaborateur</strong>.
          </p>
          <p style="color:${TEXTE};line-height:1.6;margin:0 0 28px">
            Vous pourrez importer des pièces comptables, suivre les traitements IA 
            et consulter les rapports financiers de l'entreprise.
          </p>

          <div style="background:${VERT_BG};border-left:4px solid ${VERT_CLAIR};padding:16px 20px;border-radius:0 8px 8px 0;margin:24px 0">
            <strong style="color:${VERT_FONCE}">Entreprise :</strong>
            <span style="color:${TEXTE};margin-left:8px">${nomPME}</span><br>
            <strong style="color:${VERT_FONCE}">Expiration :</strong>
            <span style="color:${TEXTE};margin-left:8px">${dateExpiration}</span>
          </div>

          <div style="text-align:center;margin:32px 0">
            <a href="${lienAcceptation}" 
               style="background:${VERT_CLAIR};color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">
              Rejoindre l'équipe →
            </a>
          </div>

          <p style="color:${TEXTE_LIGHT};font-size:12px;line-height:1.6;margin:16px 0 0">
            Lien valide jusqu'au ${dateExpiration}. Si vous n'êtes pas concerné par cette invitation, ignorez cet email.
          </p>
        </td></tr>
        <tr><td style="background:${VERT_FONCE};padding:20px 40px;text-align:center">
          <p style="color:#A7F3D0;font-size:12px;margin:0">© ${new Date().getFullYear()} H-Compta AI · <a href="${APP_URL}" style="color:#4ADE80;text-decoration:none">hcompta-ai.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return envoyerEmail({
    to:          emailDestinataire,
    subject:     `${nomPME} vous invite à rejoindre H-Compta AI`,
    htmlContent: html,
  });
}

// ─── 4. Rapport mensuel Expert → PME (avec PDF joint) ─────────
async function envoyerRapportMensuel({ emailDestinataire, nomPME, periode, nomExpert, nomCabinet, commentaire, pdfHtml }) {
  // Encoder le HTML du PDF en base64 pour la pièce jointe
  const pdfBase64 = Buffer.from(pdfHtml || '', 'utf-8').toString('base64');
  const moisLabel = periode ? new Date(periode + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : periode;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:${VERT_FONCE};padding:32px 40px">
          <div style="font-size:24px;font-weight:700;color:#fff">H-Compta <span style="color:#4ADE80">AI</span></div>
          <div style="color:#A7F3D0;font-size:13px;margin-top:4px">Rapport mensuel · ${moisLabel || periode}</div>
        </td></tr>
        <tr><td style="padding:40px">
          <h2 style="color:${VERT_FONCE};margin:0 0 8px">Rapport financier — ${moisLabel || periode}</h2>
          <p style="color:${TEXTE_LIGHT};font-size:13px;margin:0 0 24px">Préparé par ${nomExpert} · ${nomCabinet}</p>

          <p style="color:${TEXTE};line-height:1.6;margin:0 0 20px">
            Bonjour,<br><br>
            Veuillez trouver ci-joint le rapport financier de <strong>${nomPME}</strong> 
            pour la période de <strong>${moisLabel || periode}</strong>, 
            préparé par votre expert-comptable <strong>${nomExpert}</strong> (${nomCabinet}).
          </p>

          ${commentaire ? `
          <div style="background:${VERT_BG};border-left:4px solid ${VERT_CLAIR};padding:20px;border-radius:0 8px 8px 0;margin:24px 0">
            <strong style="color:${VERT_FONCE};display:block;margin-bottom:10px">Analyse de votre expert :</strong>
            <p style="color:${TEXTE};line-height:1.7;margin:0;font-style:italic">${commentaire.replace(/\n/g, '<br>')}</p>
          </div>` : ''}

          <div style="background:#FFF9E6;border:1px solid #FDE68A;border-radius:8px;padding:16px 20px;margin:24px 0">
            <p style="color:#92400E;margin:0;font-size:13px">
              📎 Le rapport complet (Balance, Résultat, Trésorerie) est joint à cet email en pièce jointe HTML.
            </p>
          </div>

          <div style="text-align:center;margin:32px 0">
            <a href="${APP_URL}/dashboard_pme_v3.html" 
               style="background:${VERT_CLAIR};color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
              Accéder à mon dashboard →
            </a>
          </div>
        </td></tr>
        <tr><td style="background:${VERT_FONCE};padding:20px 40px;text-align:center">
          <p style="color:#A7F3D0;font-size:12px;margin:0">
            ${nomCabinet} · via H-Compta AI · 
            <a href="${APP_URL}" style="color:#4ADE80;text-decoration:none">hcompta-ai.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const attachments = pdfHtml ? [{
    name:    `rapport-${nomPME.replace(/\s+/g, '-')}-${periode}.html`,
    content: pdfBase64,
  }] : [];

  return envoyerEmail({
    to:          emailDestinataire,
    subject:     `Rapport financier ${moisLabel || periode} — ${nomPME}`,
    htmlContent: html,
    attachments,
  });
}

// ─── 5. Confirmation de paiement CinetPay ────────────────────
async function envoyerConfirmationPaiement({ emailDestinataire, nomPME, plan, montant, devise, transactionId }) {
  const planLabels = { TPE: 'Plan TPE', PME: 'Plan PME', ENTERPRISE: 'Plan Enterprise' };
  const planLabel  = planLabels[plan] || plan;
  const dateNow    = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:${VERT_FONCE};padding:32px 40px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff">H-Compta <span style="color:#4ADE80">AI</span></div>
          <div style="color:#A7F3D0;font-size:13px;margin-top:6px">Confirmation de paiement</div>
        </td></tr>
        <tr><td style="padding:40px">
          <div style="text-align:center;margin-bottom:28px">
            <div style="width:64px;height:64px;background:#D1FAE5;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:32px">✅</div>
          </div>
          <h2 style="color:${VERT_FONCE};text-align:center;margin:0 0 8px">Paiement confirmé !</h2>
          <p style="color:${TEXTE_LIGHT};text-align:center;font-size:13px;margin:0 0 32px">${dateNow}</p>

          <p style="color:${TEXTE};line-height:1.6;margin:0 0 24px">
            Merci pour votre abonnement à H-Compta AI. Votre compte <strong>${nomPME}</strong> 
            est maintenant actif pour les 31 prochains jours.
          </p>

          <!-- Récapitulatif transaction -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:${VERT_BG};border-radius:8px;margin:24px 0">
            <tr><td style="padding:20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:${TEXTE_LIGHT};font-size:13px;padding:6px 0">Plan souscrit</td>
                  <td style="color:${VERT_FONCE};font-weight:700;text-align:right;padding:6px 0">${planLabel}</td>
                </tr>
                <tr>
                  <td style="color:${TEXTE_LIGHT};font-size:13px;padding:6px 0">Montant payé</td>
                  <td style="color:${VERT_FONCE};font-weight:700;text-align:right;padding:6px 0">${montant} ${devise}</td>
                </tr>
                <tr>
                  <td style="color:${TEXTE_LIGHT};font-size:13px;padding:6px 0">Référence</td>
                  <td style="color:${TEXTE};font-size:12px;text-align:right;padding:6px 0">${transactionId}</td>
                </tr>
                <tr>
                  <td style="color:${TEXTE_LIGHT};font-size:13px;padding:6px 0">Statut</td>
                  <td style="text-align:right;padding:6px 0">
                    <span style="background:#D1FAE5;color:#065F46;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">PAYÉ</span>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>

          <div style="text-align:center;margin:32px 0">
            <a href="${APP_URL}/dashboard_pme_v3.html" 
               style="background:${VERT_CLAIR};color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">
              Accéder à mon dashboard →
            </a>
          </div>

          <p style="color:${TEXTE_LIGHT};font-size:12px;line-height:1.6;margin:0">
            Conservez cet email comme reçu de paiement. Pour toute question, contactez-nous à 
            <a href="mailto:support@hcompta-ai.com" style="color:${VERT_CLAIR}">support@hcompta-ai.com</a>.
          </p>
        </td></tr>
        <tr><td style="background:${VERT_FONCE};padding:20px 40px;text-align:center">
          <p style="color:#A7F3D0;font-size:12px;margin:0">© ${new Date().getFullYear()} H-Compta AI · <a href="${APP_URL}" style="color:#4ADE80;text-decoration:none">hcompta-ai.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return envoyerEmail({
    to:          emailDestinataire,
    subject:     `✅ Paiement confirmé — ${planLabel} H-Compta AI`,
    htmlContent: html,
  });
}

// ─── Exports ──────────────────────────────────────────────────
module.exports = {
  envoyerEmail,
  envoyerConfirmationInscription,
  envoyerInvitationCabinet,
  envoyerInvitationCollaborateur,
  envoyerRapportMensuel,
  envoyerConfirmationPaiement,
};
