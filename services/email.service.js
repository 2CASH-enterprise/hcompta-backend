// ============================================================
// H-Compta AI — Service d'envoi d'emails via Brevo
// ============================================================
const axios = require('axios');

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

// ----------------------------------------------------------------
// HELPER : Appel API Brevo
// ----------------------------------------------------------------
async function envoyerEmail({ to, subject, htmlContent, textContent }) {
  const response = await axios.post(
    BREVO_API_URL,
    {
      sender: {
        name:  process.env.BREVO_FROM_NAME  || 'H-Compta AI',
        email: process.env.BREVO_FROM_EMAIL || 'noreply@hcompta-ai.com',
      },
      to: Array.isArray(to) ? to : [{ email: to }],
      subject,
      htmlContent,
      textContent: textContent || subject,
    },
    {
      headers: {
        'api-key':      process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
  return response.data;
}

// ----------------------------------------------------------------
// EMAIL 1 : Invitation Cabinet Expert
// ----------------------------------------------------------------
async function envoyerInvitationCabinet({ emailDestinataire, nomPME, nomCabinet, tokenInvitation, expiresAt }) {
  const appUrl   = process.env.APP_URL || 'https://hcompta-ai.com';
  const lienAcceptation = `${appUrl}/dashboard_expert_comptable_v2.html?token=${tokenInvitation}`;
  const dateExpiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '7 jours';

  const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invitation H-Compta AI</title>
</head>
<body style="margin:0;padding:0;background:#F2FAF6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2FAF6;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0D2B22,#2E8269);padding:32px 40px;text-align:center">
            <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-.5px">H-Compta AI</div>
            <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px">Comptabilité SYSCOHADA · Zone OHADA</div>
          </td>
        </tr>

        <!-- Corps -->
        <tr>
          <td style="padding:40px">
            <div style="font-size:22px;font-weight:700;color:#0D2B22;margin-bottom:8px">
              🤝 Invitation à rejoindre un dossier
            </div>
            <div style="font-size:15px;color:#5C7269;margin-bottom:24px;line-height:1.6">
              Bonjour${nomCabinet ? ' ' + nomCabinet : ''},
            </div>
            <div style="font-size:15px;color:#2D3A35;line-height:1.7;margin-bottom:24px">
              <strong style="color:#0D2B22">${nomPME}</strong> vous invite à accéder à leur dossier comptable 
              sur <strong>H-Compta AI</strong> en tant qu'<strong>Expert-Comptable</strong>.
            </div>

            <!-- Box info -->
            <div style="background:#F6FAF8;border:1px solid #C5DED6;border-radius:10px;padding:20px 24px;margin-bottom:28px">
              <div style="font-size:13px;font-weight:700;color:#2E8269;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">
                Ce que vous pourrez faire
              </div>
              <div style="font-size:14px;color:#2D3A35;line-height:1.8">
                ✅ Consulter toutes les pièces comptables<br>
                ✅ Analyser et valider les écritures SYSCOHADA<br>
                ✅ Accéder aux rapports TVA et financiers<br>
                ✅ Utiliser Mariah, l'assistante IA comptable<br>
                ✅ Exporter vers Sage 100 et Odoo
              </div>
            </div>

            <!-- Bouton CTA -->
            <div style="text-align:center;margin-bottom:28px">
              <a href="${lienAcceptation}" 
                 style="display:inline-block;background:linear-gradient(135deg,#2E8269,#1A5C45);color:#fff;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-.2px">
                Accéder au dossier →
              </a>
            </div>

            <!-- Expiration -->
            <div style="text-align:center;font-size:13px;color:#A0B5AD;margin-bottom:24px">
              Ce lien expire le <strong>${dateExpiry}</strong>
            </div>

            <!-- Lien texte -->
            <div style="background:#F9F9F9;border-radius:8px;padding:12px 16px;font-size:12px;color:#A0B5AD;word-break:break-all">
              Lien direct : ${lienAcceptation}
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F6FAF8;padding:20px 40px;text-align:center;border-top:1px solid #E3ECE8">
            <div style="font-size:12px;color:#A0B5AD;line-height:1.6">
              H-Compta AI · SolutionH · Zone OHADA<br>
              Cet email a été envoyé automatiquement — ne pas répondre à ce message.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return envoyerEmail({
    to:          emailDestinataire,
    subject:     `[H-Compta AI] ${nomPME} vous invite à rejoindre leur espace comptable`,
    htmlContent,
  });
}

// ----------------------------------------------------------------
// EMAIL 2 : Invitation Collaborateur
// ----------------------------------------------------------------
async function envoyerInvitationCollaborateur({ emailDestinataire, nomPME, nomCollaborateur, tokenInvitation, expiresAt }) {
  const appUrl   = process.env.APP_URL || 'https://hcompta-ai.com';
  const lienAcceptation = `${appUrl}/dashboard_pme_v3.html?token=${tokenInvitation}`;
  const dateExpiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '7 jours';

  const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invitation H-Compta AI</title>
</head>
<body style="margin:0;padding:0;background:#F2FAF6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2FAF6;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0D2B22,#2E8269);padding:32px 40px;text-align:center">
            <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-.5px">H-Compta AI</div>
            <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px">Comptabilité SYSCOHADA · Zone OHADA</div>
          </td>
        </tr>

        <!-- Corps -->
        <tr>
          <td style="padding:40px">
            <div style="font-size:22px;font-weight:700;color:#0D2B22;margin-bottom:8px">
              👤 Vous êtes invité à collaborer
            </div>
            <div style="font-size:15px;color:#5C7269;margin-bottom:24px;line-height:1.6">
              Bonjour${nomCollaborateur ? ' ' + nomCollaborateur : ''},
            </div>
            <div style="font-size:15px;color:#2D3A35;line-height:1.7;margin-bottom:24px">
              <strong style="color:#0D2B22">${nomPME}</strong> vous invite à rejoindre leur espace 
              sur <strong>H-Compta AI</strong> en tant que <strong>Collaborateur</strong>.
            </div>

            <!-- Box info -->
            <div style="background:#F6FAF8;border:1px solid #C5DED6;border-radius:10px;padding:20px 24px;margin-bottom:28px">
              <div style="font-size:13px;font-weight:700;color:#2E8269;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">
                Vos accès
              </div>
              <div style="font-size:14px;color:#2D3A35;line-height:1.8">
                ✅ Consulter les pièces comptables<br>
                ✅ Voir les rapports et tableaux de bord<br>
                ✅ Accès en lecture aux imputations IA<br>
                🔒 Modification réservée au compte principal
              </div>
            </div>

            <!-- Bouton CTA -->
            <div style="text-align:center;margin-bottom:28px">
              <a href="${lienAcceptation}"
                 style="display:inline-block;background:linear-gradient(135deg,#2E8269,#1A5C45);color:#fff;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-.2px">
                Rejoindre l'espace →
              </a>
            </div>

            <div style="text-align:center;font-size:13px;color:#A0B5AD;margin-bottom:24px">
              Ce lien expire le <strong>${dateExpiry}</strong>
            </div>

            <div style="background:#F9F9F9;border-radius:8px;padding:12px 16px;font-size:12px;color:#A0B5AD;word-break:break-all">
              Lien direct : ${lienAcceptation}
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F6FAF8;padding:20px 40px;text-align:center;border-top:1px solid #E3ECE8">
            <div style="font-size:12px;color:#A0B5AD;line-height:1.6">
              H-Compta AI · SolutionH · Zone OHADA<br>
              Cet email a été envoyé automatiquement — ne pas répondre à ce message.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return envoyerEmail({
    to:          emailDestinataire,
    subject:     `[H-Compta AI] Vous êtes invité à rejoindre ${nomPME}`,
    htmlContent,
  });
}

// ----------------------------------------------------------------
// EMAIL 3 : Confirmation d'inscription PME
// ----------------------------------------------------------------
async function envoyerConfirmationInscription({ emailDestinataire, nomPME, nomContact, pays }) {
  const appUrl = process.env.APP_URL || 'https://hcompta-ai.com';

  const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2FAF6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F2FAF6;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
        <tr>
          <td style="background:linear-gradient(135deg,#0D2B22,#2E8269);padding:32px 40px;text-align:center">
            <div style="font-size:28px;font-weight:900;color:#fff">H-Compta AI</div>
            <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px">Bienvenue dans la famille 🎉</div>
          </td>
        </tr>
        <tr>
          <td style="padding:40px">
            <div style="font-size:22px;font-weight:700;color:#0D2B22;margin-bottom:16px">
              Bienvenue, ${nomContact || nomPME} ! 🎉
            </div>
            <div style="font-size:15px;color:#2D3A35;line-height:1.7;margin-bottom:24px">
              Votre espace <strong>${nomPME}</strong> est prêt sur H-Compta AI.<br>
              Votre comptabilité SYSCOHADA est maintenant pilotée par l'IA.
            </div>
            <div style="background:#F6FAF8;border:1px solid #C5DED6;border-radius:10px;padding:20px 24px;margin-bottom:28px">
              <div style="font-size:13px;font-weight:700;color:#2E8269;margin-bottom:12px">VOTRE ESSAI GRATUIT — 30 JOURS</div>
              <div style="font-size:14px;color:#2D3A35;line-height:1.8">
                ✅ Import illimité de pièces comptables<br>
                ✅ Analyse IA automatique SYSCOHADA<br>
                ✅ TVA calculée automatiquement (${pays || 'CI'} · 18%)<br>
                ✅ Export Sage 100 et Odoo<br>
                ✅ Invitation cabinet expert incluse
              </div>
            </div>
            <div style="text-align:center">
              <a href="${appUrl}/dashboard_pme_v3.html"
                 style="display:inline-block;background:linear-gradient(135deg,#2E8269,#1A5C45);color:#fff;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:700">
                Accéder à mon espace →
              </a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#F6FAF8;padding:20px 40px;text-align:center;border-top:1px solid #E3ECE8">
            <div style="font-size:12px;color:#A0B5AD">H-Compta AI · SolutionH · Zone OHADA</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return envoyerEmail({
    to:          emailDestinataire,
    subject:     `[H-Compta AI] Bienvenue ${nomPME} — votre espace est prêt ! 🎉`,
    htmlContent,
  });
}

module.exports = {
  envoyerEmail,
  envoyerInvitationCabinet,
  envoyerInvitationCollaborateur,
  envoyerConfirmationInscription,
};
