// H-Compta AI — Backend Node.js branché sur les vraies tables Supabase
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage() });
require('dotenv').config();
const axios   = require('axios');
const express = require('express');
const cors    = require('cors');
const supabase = require('./config/supabase');
const { genererToken, authRequis, adminRequis, authOptionnel } = require('./middleware/auth.middleware');

const app = express();

// ----------------------------------------------------------------
// CORS — Restreint au domaine de production + dev local
// ----------------------------------------------------------------
const ORIGINES_AUTORISEES = [
  'https://hcompta-ai.com',
  'https://www.hcompta-ai.com',
  'https://2cash-enterprise.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
];
app.use(cors({
  origin: function(origin, callback) {
    // Autoriser les requêtes sans origin (Postman, mobile, Render health check)
    if (!origin) return callback(null, true);
    if (ORIGINES_AUTORISEES.includes(origin)) return callback(null, true);
    return callback(new Error('CORS non autorisé pour : ' + origin));
  },
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));
app.use(express.json());

app.use('/api/pieces',     require('./routes/pieces.routes'));
app.use('/api/tva',        require('./routes/tva.routes'));
app.use('/api/export',     require('./routes/export.routes'));
app.use('/api/mariah',     authRequis, require('./routes/mariah.routes'));
app.use('/api/traitement', authOptionnel, require('./routes/traitement.routes'));
app.use('/api/learning',   authRequis, require('./routes/learning.routes'));
app.use('/api/tiers',      authOptionnel, require('./routes/tiers.routes'));

// TVA par pays
const TVA_PAR_PAYS = {
  CI:{taux:18,label:"Côte d'Ivoire",devise:'FCFA'},
  SN:{taux:18,label:'Sénégal',devise:'FCFA'},
  CM:{taux:19.25,label:'Cameroun',devise:'FCFA'},
  BJ:{taux:18,label:'Bénin',devise:'FCFA'},
  BF:{taux:18,label:'Burkina Faso',devise:'FCFA'},
  ML:{taux:18,label:'Mali',devise:'FCFA'},
  TG:{taux:18,label:'Togo',devise:'FCFA'},
  NE:{taux:19,label:'Niger',devise:'FCFA'},
  GA:{taux:18,label:'Gabon',devise:'FCFA'},
  CG:{taux:18,label:'Congo',devise:'FCFA'},
  CD:{taux:16,label:'RD Congo',devise:'USD'},
  GN:{taux:18,label:'Guinée',devise:'EUR'},
};
const STATUTS_ALERTE = ['uploaded','error','processing'];
const STATUT_TRAITE  = 'processed';

// TEST
app.get('/', (req,res) => res.json({status:'ok',message:'H-Compta AI Backend 🚀'}));

// PAYS
app.get('/pays', (req,res) => res.json(Object.entries(TVA_PAR_PAYS).map(([code,info])=>({code,...info}))));
app.get('/pays/tva/:code', (req,res) => {
  const p = TVA_PAR_PAYS[req.params.code.toUpperCase()];
  return p ? res.json({code:req.params.code.toUpperCase(),...p}) : res.status(404).json({error:'Pays non reconnu'});
});

// STATS PME
app.get('/stats/:companyId', async (req,res) => {
  try {
    const {companyId} = req.params;
    const [{count:total,error:e1},{count:alertes,error:e2},{data:scores,error:e3},{data:ecritures,error:e4},{data:company}] = await Promise.all([
      supabase.from('pieces').select('*',{count:'exact',head:true}).eq('company_id',companyId),
      supabase.from('pieces').select('*',{count:'exact',head:true}).eq('company_id',companyId).in('status',STATUTS_ALERTE),
      supabase.from('pieces').select('score_confiance').eq('company_id',companyId).eq('status',STATUT_TRAITE).not('score_confiance','is',null),
      supabase.from('ecritures').select('compte,debit,credit').eq('company_id',companyId),
      supabase.from('companies').select('company_name,country,vat_rate,plan,subscription_amount_ht_fcfa,status,trial_end_date').eq('id',companyId).single(),
    ]);
    if(e1) return res.status(500).json({error:e1.message});
    if(e2) return res.status(500).json({error:e2.message});
    if(e3) return res.status(500).json({error:e3.message});
    if(e4) return res.status(500).json({error:e4.message});
    const scoreMoyen = scores&&scores.length>0 ? Math.round(scores.reduce((s,p)=>s+Number(p.score_confiance),0)/scores.length) : 0;
    let tvaC=0,tvaD=0;
    for(const e of ecritures||[]){
      const c=String(e.compte||'');
      if(c.startsWith('44571')) tvaC+=Number(e.credit||0)-Number(e.debit||0);
      if(c.startsWith('44551')) tvaD+=Number(e.debit||0)-Number(e.credit||0);
    }
    return res.json({
      company_id:companyId, company_name:company?.company_name||'', country:company?.country||'',
      vat_rate:company?.vat_rate||18, plan:company?.plan||'', subscription:company?.subscription_amount_ht_fcfa||0,
      status:company?.status||'', trial_end_date:company?.trial_end_date||null,
      total_factures:total||0, alertes:alertes||0, score_moyen:scoreMoyen, tva:Math.max(0,tvaC-tvaD),
    });
  } catch(err){return res.status(500).json({error:err.message});}
});

// PIECES PME
app.get('/pieces/recent/:companyId', async (req,res) => {
  try {
    const {data,error} = await supabase.from('pieces')
      .select('id,file_name,file_url,type_piece,journal,score_confiance,status,uploaded_at')
      .eq('company_id',req.params.companyId).order('uploaded_at',{ascending:false}).limit(5);
    if(error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});

app.get('/pieces/all/:companyId', async (req,res) => {
  try {
    const {data,error} = await supabase.from('pieces')
      .select('id,file_name,file_url,type_piece,journal,score_confiance,status,uploaded_at,processed_at')
      .eq('company_id',req.params.companyId).order('uploaded_at',{ascending:false});
    if(error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});

app.post('/pieces/upload', upload.single('file'), async (req,res) => {
  try {
    const {company_id,uploaded_by} = req.body;
    const file = req.file;
    if(!company_id||!file) return res.status(400).json({error:'company_id et file obligatoires'});
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g,'_');
    const path = `${company_id}/${ts}_${safeName}`;
    const {error:sErr} = await supabase.storage.from('pieces').upload(path,file.buffer,{contentType:file.mimetype,upsert:true});
    if(sErr) return res.status(500).json({error:'Stockage: '+sErr.message});
    const {data:urlData} = supabase.storage.from('pieces').getPublicUrl(path);
    const fileUrl = urlData?.publicUrl||path;
    const {data:piece,error:dErr} = await supabase.from('pieces')
      .insert([{company_id,uploaded_by:uploaded_by||null,file_url:fileUrl,file_name:file.originalname,status:'uploaded'}])
      .select().single();
    if(dErr) return res.status(500).json({error:dErr.message});
    return res.status(201).json({message:'Pièce importée avec succès',piece});
  } catch(err){return res.status(500).json({error:err.message});}
});

// TVA — géré dans /api/tva via routes/tva.routes.js
// Routes de compatibilité (aliases) pour le frontend existant
app.get('/tva/detail/:companyId', (req, res) => {
  req.url = `/detail/${req.params.companyId}`;
  if (req.query.periode) req.url += `?periode=${req.query.periode}`;
  require('./routes/tva.routes').handle(req, res);
});
app.post('/tva/generer/:companyId', (req, res) => {
  req.url = `/generer/${req.params.companyId}`;
  require('./routes/tva.routes').handle(req, res);
});

// REPORTING
// ── GET /ecritures/:companyId — Toutes les écritures d'une PME ──
app.get('/ecritures/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { periode, journal } = req.query;
    let query = supabase
      .from('ecritures')
      .select('id, journal, date_ecriture, compte, libelle, debit, credit, status, piece_id, tiers_id')
      .eq('company_id', companyId)
      .order('date_ecriture', { ascending: false })
      .order('journal')
      .limit(500);
    if (periode) {
      const debut = periode + '-01';
      const fin   = new Date(new Date(debut).getFullYear(), new Date(debut).getMonth() + 1, 0).toISOString().slice(0, 10);
      query = query.gte('date_ecriture', debut).lte('date_ecriture', fin);
    }
    if (journal) query = query.eq('journal', journal.toUpperCase());
    const { data: ecritures, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, ecritures: ecritures || [], total: count || ecritures?.length || 0 });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

app.get('/reporting/:companyId', async (req,res) => {
  try {
    const {data:ecritures,error} = await supabase.from('ecritures').select('compte,debit,credit').eq('company_id',req.params.companyId);
    if(error) return res.status(500).json({error:error.message});
    let ca=0,charges=0;
    for(const e of ecritures||[]){const c=String(e.compte||'');if(c.startsWith('7'))ca+=Number(e.credit||0)-Number(e.debit||0);if(c.startsWith('6'))charges+=Number(e.debit||0)-Number(e.credit||0);}
    const resultat=ca-charges;
    return res.json({company_id:req.params.companyId,ca:Math.max(0,ca),charges:Math.max(0,charges),resultat,taux_marge:ca>0?Math.round((resultat/ca)*100):0});
  } catch(err){return res.status(500).json({error:err.message});}
});

// UTILISATEURS
app.get('/utilisateurs/:companyId', async (req,res) => {
  try {
    const {data,error} = await supabase.from('company_users')
      .select('id,role_in_company,status,invited_by,created_at,users(id,email,full_name,phone,role,is_active)')
      .eq('company_id',req.params.companyId);
    if(error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});

// NOTIFICATIONS
app.get('/notifications/:userId', async (req,res) => {
  try {
    const {data,error} = await supabase.from('notifications').select('*').eq('user_id',req.params.userId).eq('is_read',false).order('created_at',{ascending:false}).limit(20);
    if(error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});
app.patch('/notifications/:id/read', async (req,res) => {
  try {
    const {error} = await supabase.from('notifications').update({is_read:true}).eq('id',req.params.id);
    if(error) return res.status(500).json({error:error.message});
    return res.json({success:true});
  } catch(err){return res.status(500).json({error:err.message});}
});

// EXPORTS — alias de compatibilité (gérés dans routes/export.routes.js)
// Les frontends appellent /api/export/sage/... → route file gère directement

// CABINET — helper
async function getCompaniesForExpert(expertUserId) {
  const {data} = await supabase.from('company_users').select('company_id').eq('user_id',expertUserId).eq('role_in_company','EXPERT').eq('status','active');
  return (data||[]).map(l=>l.company_id);
}

app.get('/cabinet/stats/:expertUserId', async (req,res) => {
  try {
    const ids = await getCompaniesForExpert(req.params.expertUserId);
    if(!ids.length) return res.json({total_clients:0,total_anomalies:0,ecritures_count:0,score_moyen:0,company_ids:[]});
    const [{count:anom},{count:ecr},{data:scores}] = await Promise.all([
      supabase.from('pieces').select('*',{count:'exact',head:true}).in('company_id',ids).in('status',STATUTS_ALERTE),
      supabase.from('ecritures').select('*',{count:'exact',head:true}).in('company_id',ids),
      supabase.from('pieces').select('score_confiance').in('company_id',ids).eq('status',STATUT_TRAITE).not('score_confiance','is',null),
    ]);
    const scoreMoyen = scores&&scores.length>0?Math.round(scores.reduce((s,p)=>s+Number(p.score_confiance),0)/scores.length):0;
    return res.json({total_clients:ids.length,total_anomalies:anom||0,ecritures_count:ecr||0,score_moyen:scoreMoyen,company_ids:ids});
  } catch(err){return res.status(500).json({error:err.message});}
});

app.get('/cabinet/clients/:expertUserId', async (req,res) => {
  try {
    const ids = await getCompaniesForExpert(req.params.expertUserId);
    if(!ids.length) return res.json([]);
    const clients = await Promise.all(ids.map(async cid => {
      const [{data:company},{count:alertes},{data:scores},{data:ecritures}] = await Promise.all([
        supabase.from('companies').select('id,company_name,country,plan,status,vat_rate').eq('id',cid).single(),
        supabase.from('pieces').select('*',{count:'exact',head:true}).eq('company_id',cid).in('status',STATUTS_ALERTE),
        supabase.from('pieces').select('score_confiance').eq('company_id',cid).eq('status',STATUT_TRAITE).not('score_confiance','is',null),
        supabase.from('ecritures').select('compte,debit,credit').eq('company_id',cid),
      ]);
      const score = scores&&scores.length>0?Math.round(scores.reduce((s,p)=>s+Number(p.score_confiance),0)/scores.length):0;
      let tvaC=0,tvaD=0;
      for(const e of ecritures||[]){const c=String(e.compte||'');if(c.startsWith('44571'))tvaC+=Number(e.credit||0)-Number(e.debit||0);if(c.startsWith('44551'))tvaD+=Number(e.debit||0)-Number(e.credit||0);}
      return {company_id:cid,company_name:company?.company_name||'PME',country:company?.country||'',plan:company?.plan||'',status:company?.status||'',alertes:alertes||0,score_moyen:score,tva_nette:Math.max(0,tvaC-tvaD)};
    }));
    return res.json(clients);
  } catch(err){return res.status(500).json({error:err.message});}
});

app.get('/cabinet/anomalies/:expertUserId', async (req,res) => {
  try {
    const ids = await getCompaniesForExpert(req.params.expertUserId);
    if(!ids.length) return res.json([]);
    const {data,error} = await supabase.from('pieces').select('id,file_name,file_url,journal,score_confiance,status,uploaded_at,company_id').in('company_id',ids).in('status',STATUTS_ALERTE).order('uploaded_at',{ascending:false});
    if(error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});

app.get('/cabinet/pme/:companyId', async (req,res) => {
  try {
    const {companyId} = req.params;
    const [{data:company},{data:pieces},{data:ecritures}] = await Promise.all([
      supabase.from('companies').select('id,company_name,country,plan,status,vat_rate,trial_end_date').eq('id',companyId).single(),
      supabase.from('pieces').select('id,file_name,file_url,journal,score_confiance,status,uploaded_at').eq('company_id',companyId).order('uploaded_at',{ascending:false}).limit(20),
      supabase.from('ecritures').select('compte,debit,credit').eq('company_id',companyId),
    ]);
    const alertes = (pieces||[]).filter(p=>STATUTS_ALERTE.includes(p.status)).length;
    const traites = (pieces||[]).filter(p=>p.status===STATUT_TRAITE);
    const score = traites.length>0?Math.round(traites.reduce((s,p)=>s+Number(p.score_confiance||0),0)/traites.length):0;
    let tvaC=0,tvaD=0;
    for(const e of ecritures||[]){const c=String(e.compte||'');if(c.startsWith('44571'))tvaC+=Number(e.credit||0)-Number(e.debit||0);if(c.startsWith('44551'))tvaD+=Number(e.debit||0)-Number(e.credit||0);}
    return res.json({company,total_pieces:(pieces||[]).length,alertes,score_moyen:score,tva_nette:Math.max(0,tvaC-tvaD),pieces:pieces||[]});
  } catch(err){return res.status(500).json({error:err.message});}
});

app.get('/cabinet/invitations/:email', async (req,res) => {
  try {
    const {data,error} = await supabase.from('invites')
      .select('id,role,status,expires_at,created_at,companies(id,company_name,country)')
      .eq('email',decodeURIComponent(req.params.email)).in('role',['EXPERT']).order('created_at',{ascending:false});
    if(error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});

// INVITATIONS — accepter via token (lien email) ou via user_id (dashboard)
app.post('/invitations/accepter', async (req, res) => {
  try {
    const { invite_id, expert_user_id, token: inviteToken } = req.body;

    // Retrouver l'invitation — soit par id, soit par token (lien email)
    let invite = null;
    if (inviteToken) {
      const { data, error } = await supabase
        .from('invites')
        .select('id, company_id, email, role, status, expires_at')
        .eq('token', inviteToken)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Lien d\'invitation invalide ou expiré' });
      invite = data;
    } else if (invite_id) {
      const { data, error } = await supabase
        .from('invites')
        .select('id, company_id, email, role, status, expires_at')
        .eq('id', invite_id)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Invitation introuvable' });
      invite = data;
    } else {
      return res.status(400).json({ error: 'invite_id ou token obligatoire' });
    }

    if (invite.status !== 'pending') return res.status(409).json({ error: 'Invitation déjà traitée' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Invitation expirée' });

    // Créer le compte Expert s'il n'existe pas encore
    let expertUserId = expert_user_id || null;
    if (!expertUserId) {
      // Chercher par email
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, email, full_name, role, is_active')
        .eq('email', invite.email.toLowerCase())
        .single();

      if (existingUser) {
        // Compte existant — vérifier qu'il est actif
        if (!existingUser.is_active) return res.status(403).json({ error: 'Compte désactivé' });
        expertUserId = existingUser.id;
      } else {
        // Créer le compte Expert automatiquement
        const { data: newUser, error: eUser } = await supabase
          .from('users')
          .insert([{
            email:     invite.email.toLowerCase(),
            full_name: req.body.nom_cabinet || req.body.nom_responsable || ('Cabinet ' + (invite.email.split('@')[1]?.split('.')[0] || 'Expert')),
            role:      'EXPERT',
            is_active: true,
          }])
          .select()
          .single();
        if (eUser) return res.status(500).json({ error: 'Erreur création compte : ' + eUser.message });
        expertUserId = newUser.id;
      }
    }

    // Créer le lien company_users (EXPERT ↔ PME) si pas déjà existant
    const { error: eCU } = await supabase.from('company_users').insert([{
      company_id:      invite.company_id,
      user_id:         expertUserId,
      role_in_company: invite.role || 'EXPERT',
      status:          'active',
      invited_by:      null,
    }]);
    if (eCU && !eCU.message.includes('duplicate')) {
      return res.status(500).json({ error: 'Erreur liaison PME-Cabinet : ' + eCU.message });
    }

    // Marquer l'invitation comme acceptée
    await supabase.from('invites').update({ status: 'accepted' }).eq('id', invite.id);

    // Récupérer les infos de la PME pour la réponse
    const { data: company } = await supabase
      .from('companies')
      .select('company_name, country')
      .eq('id', invite.company_id)
      .single();

    // Générer un JWT pour connexion automatique
    const token = genererToken({
      user_id:    expertUserId,
      email:      invite.email,
      role:       'EXPERT',
      company_id: null,
    });

    return res.json({
      success:    true,
      message:    'Invitation acceptée — ' + (company?.company_name || 'PME') + ' ajoutée à votre portefeuille',
      company_id: invite.company_id,
      user_id:    expertUserId,
      token,                    // ← JWT pour connexion automatique depuis le lien email
      email:      invite.email,
      role:       'EXPERT',
    });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

app.post('/invitations/refuser', async (req, res) => {
  try {
    const { invite_id } = req.body;
    if (!invite_id) return res.status(400).json({ error: 'invite_id obligatoire' });
    await supabase.from('invites').update({ status: 'declined' }).eq('id', invite_id);
    return res.json({ success: true, message: 'Invitation refusée' });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// AMBASSADEUR
app.get('/ambassadeur/stats/:userId', async (req,res) => {
  try {
    const {data:amb,error} = await supabase.from('ambassadors').select('*').eq('user_id',req.params.userId).single();
    if(error||!amb) return res.status(404).json({error:'Ambassadeur non trouvé'});
    const {data:companies} = await supabase.from('companies').select('id,status,plan,subscription_amount_ht_fcfa').eq('ambassador_id',amb.id);
    const actives = (companies||[]).filter(c=>c.status==='active');
    const essai   = (companies||[]).filter(c=>c.status==='trial');
    const taux = Number(amb.commission_rate)/100;
    const commMensuelle = actives.reduce((s,c)=>s+Number(c.subscription_amount_ht_fcfa||0)*taux,0);
    const {data:lastComm} = await supabase.from('commissions').select('payment_status,total_commission_amount,month').eq('ambassador_id',amb.id).order('month',{ascending:false}).limit(1).single();
    return res.json({ambassador_id:amb.id,user_id:req.params.userId,promo_code:amb.promo_code,mobile_money_account:amb.mobile_money_account,commission_rate:amb.commission_rate,total_filleuls:(companies||[]).length,filleuls_actifs:actives.length,filleuls_essai:essai.length,commission_mensuelle:Math.round(commMensuelle),statut_paiement:lastComm?.payment_status||'pending'});
  } catch(err){return res.status(500).json({error:err.message});}
});

app.get('/ambassadeur/filleuls/:userId', async (req,res) => {
  try {
    const {data:amb} = await supabase.from('ambassadors').select('id,commission_rate').eq('user_id',req.params.userId).single();
    if(!amb) return res.status(404).json({error:'Ambassadeur non trouvé'});
    const {data:companies,error} = await supabase.from('companies').select('id,company_name,country,plan,status,subscription_amount_ht_fcfa,trial_end_date,created_at').eq('ambassador_id',amb.id).order('created_at',{ascending:false});
    if(error) return res.status(500).json({error:error.message});
    const taux = Number(amb.commission_rate)/100;
    return res.json((companies||[]).map(c=>({company_id:c.id,company_name:c.company_name,country:c.country,plan:c.plan,status:c.status,trial_end_date:c.trial_end_date,date_inscription:c.created_at,commission:c.status==='active'?Math.round(Number(c.subscription_amount_ht_fcfa||0)*taux):0})));
  } catch(err){return res.status(500).json({error:err.message});}
});

app.get('/ambassadeur/historique/:userId', async (req,res) => {
  try {
    const {data:amb} = await supabase.from('ambassadors').select('id').eq('user_id',req.params.userId).single();
    if(!amb) return res.status(404).json({error:'Ambassadeur non trouvé'});
    const {data,error} = await supabase.from('commissions').select('*').eq('ambassador_id',amb.id).order('month',{ascending:false});
    if(error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});

app.get('/ambassadeur/profil/:userId', async (req,res) => {
  try {
    const [{data:user},{data:amb}] = await Promise.all([
      supabase.from('users').select('id,email,full_name,phone,country').eq('id',req.params.userId).single(),
      supabase.from('ambassadors').select('id,promo_code,mobile_money_account,commission_rate,status,created_at').eq('user_id',req.params.userId).single(),
    ]);
    return res.json({...user,...amb});
  } catch(err){return res.status(500).json({error:err.message});}
});

app.post('/ambassadeur/code-promo/valider', async (req,res) => {
  try {
    const {code_promo} = req.body;
    if(!code_promo) return res.status(400).json({error:'code_promo obligatoire'});
    const {data:amb,error} = await supabase.from('ambassadors').select('id,promo_code,commission_rate').eq('promo_code',code_promo.toUpperCase()).eq('status','active').single();
    if(error||!amb) return res.status(404).json({valid:false,error:'Code promo invalide'});
    return res.json({valid:true,ambassador_id:amb.id,commission_rate:amb.commission_rate,avantages:{essai_jours:30,remise_pct:Number(amb.commission_rate),remise_mois:3}});
  } catch(err){return res.status(500).json({error:err.message});}
});

// LANDING — INSCRIPTION
app.post('/inscription/pme', async (req,res) => {
  try {
    const {company_name,email,pays,plan,rccm,code_promo,phone,full_name} = req.body;
    if(!company_name||!email||!pays||!plan||!rccm) return res.status(400).json({error:'Champs obligatoires: company_name, email, pays, plan, rccm'});
    const paysInfo = TVA_PAR_PAYS[pays.toUpperCase()];
    if(!paysInfo) return res.status(400).json({error:'Pays non reconnu'});
    const {data:existing} = await supabase.from('users').select('id').eq('email',email.toLowerCase()).single();
    if(existing) return res.status(409).json({error:'Un compte avec cet email existe déjà'});
    let ambassadorId = null;
    if(code_promo){
      const {data:amb} = await supabase.from('ambassadors').select('id').eq('promo_code',code_promo.toUpperCase()).eq('status','active').single();
      if(amb) ambassadorId = amb.id;
    }
    // Prix selon devise du pays
    const planPrixFCFA = {tpe:12500, pme:25000, enterprise:75000};
    const planPrixUSD  = {tpe:20,    pme:40,    enterprise:150};
    const planPrixEUR  = {tpe:19,    pme:38,    enterprise:140};
    const planPrix = paysInfo.devise === 'USD' ? planPrixUSD
                   : paysInfo.devise === 'EUR' ? planPrixEUR
                   : planPrixFCFA;
    const montant  = planPrix[plan.toLowerCase()]||25000;
    const trialEnd = new Date(); trialEnd.setDate(trialEnd.getDate()+30);
    const {data:user,error:e1} = await supabase.from('users').insert([{email:email.toLowerCase(),full_name:full_name||company_name,phone:phone||null,role:'PME_OWNER',country:pays.toUpperCase()}]).select().single();
    if(e1) return res.status(500).json({error:e1.message});
    const {data:company,error:e2} = await supabase.from('companies').insert([{company_name,email:email.toLowerCase(),rccm,country:pays.toUpperCase(),vat_rate:paysInfo.taux,plan:plan.toLowerCase(),subscription_amount_ht_fcfa:montant,trial_start_date:new Date().toISOString().slice(0,10),trial_end_date:trialEnd.toISOString().slice(0,10),owner_user_id:user.id,ambassador_id:ambassadorId,promo_code_used:code_promo?code_promo.toUpperCase():null,status:'trial'}]).select().single();
    if(e2) return res.status(500).json({error:e2.message});
    await supabase.from('company_users').insert([{company_id:company.id,user_id:user.id,role_in_company:'OWNER',status:'active'}]);

    // Envoyer email de bienvenue
    try {
      const emailService = require('./services/email.service');
      await emailService.envoyerConfirmationInscription({
        emailDestinataire: email,
        nomPME:            company_name,
        nomContact:        full_name || null,
        pays:              pays.toUpperCase(),
      });
    } catch(emailErr) {
      console.error('Erreur email bienvenue:', emailErr.message);
    }

    return res.status(201).json({success:true,message:"Inscription réussie ! Votre période d'essai de 30 jours commence maintenant.",user_id:user.id,company_id:company.id,trial_end:trialEnd.toISOString().slice(0,10),remise:ambassadorId?{active:true,mois:3}:null});
  } catch(err){return res.status(500).json({error:err.message});}
});

// CONNEXION
app.post('/connexion', async (req,res) => {
  try {
    const {email} = req.body;
    if(!email) return res.status(400).json({error:'Email obligatoire'});
    const {data:user,error} = await supabase.from('users').select('id,email,full_name,role,country,expert_firm_id,is_active').eq('email',email.toLowerCase()).single();
    if(error||!user) return res.status(404).json({error:'Aucun compte trouvé avec cet email'});
    if(!user.is_active) return res.status(403).json({error:'Compte désactivé'});
    let company = null;
    if(['PME_OWNER','COLLABORATOR'].includes(user.role)){
      const {data:cu} = await supabase.from('company_users').select('company_id,companies(id,company_name,country,plan,status,vat_rate)').eq('user_id',user.id).in('role_in_company',['OWNER','COLLABORATOR']).eq('status','active').single();
      company = cu?.companies||null;
    }
    // Générer le JWT
    const token = genererToken({
      user_id:    user.id,
      email:      user.email,
      role:       user.role,
      country:    user.country,
      company_id: company?.id || null,
    });
    const redirectMap = {PME_OWNER:'/dashboard-pme',COLLABORATOR:'/dashboard-pme',EXPERT:'/dashboard-expert',AMBASSADOR:'/dashboard-ambassadeur',ADMIN:'/dashboard-admin'};
    return res.json({
      success:   true,
      token,                    // ← JWT retourné
      user_id:   user.id,
      email:     user.email,
      full_name: user.full_name,
      role:      user.role,
      country:   user.country,
      company,
      redirect:  redirectMap[user.role]||'/dashboard-pme',
    });
  } catch(err){return res.status(500).json({error:err.message});}
});

// ADMIN LOGIN — Authentification sécurisée dashboard admin
app.post('/admin/login', async (req, res) => {
  try {
    const { code } = req.body;
    const ADMIN_CODE = process.env.ADMIN_CODE || 'hcompta2026admin';
    if (!code || code !== ADMIN_CODE) {
      return res.status(401).json({ error: 'Code admin incorrect' });
    }
    // Générer un token admin (durée 8h)
    const token = genererToken({ role: 'ADMIN', email: 'admin@hcompta-ai.com' });
    return res.json({ success: true, token });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ADMIN — Vérifier token valide
app.get('/admin/verify', adminRequis, (req, res) => {
  return res.json({ success: true, user: req.user });
});

// DEMANDE DEMO
app.post('/demande-demo', async (req,res) => {
  try {
    const {nom,email} = req.body;
    if(!nom||!email) return res.status(400).json({error:'Nom et email obligatoires'});
    console.log('Demande demo:',req.body);
    return res.json({success:true,message:'Demande reçue ! Notre équipe vous contacte sous 24h.'});
  } catch(err){return res.status(500).json({error:err.message});}
});

// INVITATIONS — envoi et liste
app.post('/invitations/envoyer', async (req,res) => {
  try {
    const {company_id, email, role, invited_by, expires_at, message} = req.body;
    if (!company_id || !email || !role) return res.status(400).json({error:'company_id, email et role obligatoires'});

    // Générer un token unique
    const token = require('crypto').randomBytes(32).toString('hex');

    // Récupérer les infos de la société
    const {data: company} = await supabase
      .from('companies')
      .select('company_name, country')
      .eq('id', company_id)
      .single();

    const {data: invite, error} = await supabase.from('invites').insert([{
      company_id,
      email:      email.toLowerCase(),
      role,
      token,
      status:     'pending',
      expires_at: expires_at || new Date(Date.now() + 7*24*60*60*1000).toISOString(),
      invited_by: invited_by || null,
    }]).select().single();

    if (error) return res.status(500).json({error: error.message});

    // Envoyer l'email selon le rôle
    try {
      const emailService = require('./services/email.service');
      console.log(`📧 Envoi invitation ${role} à ${email}...`);
      if (role === 'EXPERT') {
        await emailService.envoyerInvitationCabinet({
          emailDestinataire: email,
          nomPME:            company?.company_name || 'Une PME',
          tokenInvitation:   token,
          expiresAt:         invite.expires_at,
        });
      } else {
        await emailService.envoyerInvitationCollaborateur({
          emailDestinataire: email,
          nomPME:            company?.company_name || 'Une PME',
          tokenInvitation:   token,
          expiresAt:         invite.expires_at,
        });
      }
      console.log(`✅ Email invitation envoyé à ${email}`);
    } catch(emailErr) {
      // L'email a échoué — logger le détail complet pour diagnostic
      const errDetail = emailErr.response?.data || emailErr.message || 'Erreur inconnue';
      console.error('❌ BREVO ERREUR INVITATION:', JSON.stringify(errDetail));
      console.error('❌ Status:', emailErr.response?.status);
      console.error('❌ BREVO_API_KEY définie:', !!process.env.BREVO_API_KEY);
      console.error('❌ BREVO_FROM_EMAIL:', process.env.BREVO_FROM_EMAIL || 'NON DÉFINI');
      // Logger dans Supabase pour consultation depuis l'admin
      try {
        await supabase.from('prompt_logs').insert([{
          prompt_code: 'email_error',
          company_id:  company_id,
          input_payload: { type: 'invitation', email, role },
          output_payload: { error: String(errDetail), status: emailErr.response?.status || 0 },
          score: 0,
        }]);
      } catch(logErr) {};
    }

    return res.json({
      success: true,
      message: `Invitation envoyée à ${email}`,
      token,
      invite,
    });
  } catch(err) {return res.status(500).json({error:err.message});}
});

app.get('/invitations/:companyId', async (req,res) => {
  try {
    const {data,error} = await supabase.from('invites')
      .select('id, email, role, status, expires_at, created_at')
      .eq('company_id', req.params.companyId)
      .order('created_at', {ascending:false});
    if (error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});

// BLOG
// ── GET /blog — Articles publiés (landing page + blog index) ──
app.get('/blog', async (req, res) => {
  try {
    const { country, limit = 10, offset = 0, category } = req.query;
    let query = supabase
      .from('blog_posts')
      .select('id,title,slug,excerpt,cover_image_url,country,category,published_at,author,views,keywords')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (country && country !== 'ALL') query = query.or(`country.eq.${country},country.eq.ALL`);
    if (category) query = query.eq('category', category);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, articles: data || [], total: data?.length || 0 });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ── GET /blog/:slug — Article individuel complet (page SEO) ──
app.get('/blog/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { data, error } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('slug', slug)
      .eq('is_published', true)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Article non trouvé' });
    // Incrémenter les vues
    await supabase.from('blog_posts').update({ views: (data.views || 0) + 1 }).eq('id', data.id);
    return res.json({ success: true, article: data });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ── POST /api/blog — Créer un article (admin) ─────────────────
app.post('/api/blog', async (req, res) => {
  try {
    const { title, slug, excerpt, content, meta_title, meta_description, keywords,
            country, category, cover_image_url, is_published, author } = req.body;
    if (!title || !slug) return res.status(400).json({ error: 'title et slug obligatoires' });
    const { data, error } = await supabase.from('blog_posts').insert([{
      title, slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      excerpt, content, meta_title, meta_description,
      keywords: keywords || [],
      country: country || 'ALL',
      category: category || 'Comptabilité',
      cover_image_url: cover_image_url || null,
      is_published: is_published || false,
      published_at: is_published ? new Date().toISOString() : null,
      author: author || 'H-Compta AI',
    }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, article: data });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/blog/:id — Modifier un article (admin) ─────────
app.patch('/api/blog/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    if (updates.is_published === true && !updates.published_at) {
      updates.published_at = new Date().toISOString();
    }
    const { data, error } = await supabase.from('blog_posts').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, article: data });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/blog/:id — Supprimer un article (admin) ───────
app.delete('/api/blog/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('blog_posts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ================================================================
// REPORTING MENSUEL — Balance, Résultat, Trésorerie
// ================================================================

// Helper : dates de début/fin d'un mois
function moisVersDateRange(periode) {
  // periode = "2026-03"
  const [year, month] = periode.split('-').map(Number);
  const debut = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const fin   = new Date(year, month, 0).toISOString().slice(0, 10);
  return { debut, fin };
}

// Helper : 3 périodes glissantes depuis une période donnée
function troisMoisGlissants(periode) {
  const [year, month] = periode.split('-').map(Number);
  const mois = [];
  for (let i = 2; i >= 0; i--) {
    let m = month - i;
    let y = year;
    if (m <= 0) { m += 12; y -= 1; }
    mois.push(`${y}-${String(m).padStart(2,'0')}`);
  }
  return mois; // ["2026-01","2026-02","2026-03"]
}

// Helper : libellé SYSCOHADA d'un compte
function libelleCompte(compte) {
  const c = String(compte || '');
  const map = {
    '101':'Capital','106':'Réserves','111':'Report à nouveau',
    '161':'Emprunts','401':'Fournisseurs','411':'Clients',
    '421':'Personnel','431':'Sécurité sociale','441':'État impôts',
    '445':'TVA','521':'Banques','531':'Chèques','571':'Caisse',
    '601':'Achats marchandises','602':'Achats matières',
    '604':'Achats études','605':'Achats matériels',
    '611':'Transports','612':'Locations','613':'Entretien',
    '614':'Assurances','618':'Divers charges','621':'Personnel ext.',
    '631':'Impôts et taxes','641':'Rémunérations','645':'Charges sociales',
    '661':'Charges intérêts','671':'Charges HAO','681':'Dotations amort.',
    '701':'Ventes marchandises','702':'Ventes produits finis',
    '706':'Services vendus','707':'Produits accessoires',
    '721':'Production immobilisée','731':'Variations stocks',
    '741':'Subventions','751':'Produits financiers','771':'Produits HAO',
    '781':'Reprises amort.',
  };
  const key3 = c.slice(0,3);
  const key2 = c.slice(0,2);
  const key1 = c.slice(0,1);
  if (map[key3]) return map[key3];
  if (['60','61','62','63','64','65','66','67','68'].includes(key2)) return 'Charges ' + key2;
  if (['70','71','72','73','74','75','76','77','78'].includes(key2)) return 'Produits ' + key2;
  return 'Compte ' + key3;
}

// ── GET /reporting/balance/:companyId ────────────────────────
app.get('/reporting/balance/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const periode = req.query.periode || new Date().toISOString().slice(0, 7);
    const { debut, fin } = moisVersDateRange(periode);

    const { data, error } = await supabase
      .from('ecritures')
      .select('compte, debit, credit')
      .eq('company_id', companyId)
      .gte('date_ecriture', debut)
      .lte('date_ecriture', fin);

    if (error) return res.status(500).json({ error: error.message });

    // Agréger par compte
    const map = {};
    for (const e of data || []) {
      const c = String(e.compte || '').slice(0, 6);
      if (!map[c]) map[c] = { compte: c, libelle: libelleCompte(c), debit: 0, credit: 0 };
      map[c].debit  += Number(e.debit  || 0);
      map[c].credit += Number(e.credit || 0);
    }
    const lignes = Object.values(map)
      .map(l => ({ ...l, solde: l.debit - l.credit }))
      .sort((a, b) => a.compte.localeCompare(b.compte));

    const totDebit  = lignes.reduce((s, l) => s + l.debit,  0);
    const totCredit = lignes.reduce((s, l) => s + l.credit, 0);

    return res.json({
      success: true, periode, debut, fin,
      lignes,
      totaux: { debit: totDebit, credit: totCredit, solde: totDebit - totCredit },
      nb_ecritures: (data || []).length,
    });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ── GET /reporting/resultat/:companyId ───────────────────────
app.get('/reporting/resultat/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const periode = req.query.periode || new Date().toISOString().slice(0, 7);
    const { debut, fin } = moisVersDateRange(periode);

    const { data, error } = await supabase
      .from('ecritures')
      .select('compte, debit, credit, libelle')
      .eq('company_id', companyId)
      .gte('date_ecriture', debut)
      .lte('date_ecriture', fin)
      .or('compte.like.6%,compte.like.7%');

    if (error) return res.status(500).json({ error: error.message });

    const charges = {}, produits = {};
    for (const e of data || []) {
      const c = String(e.compte || '').slice(0, 3);
      if (c.startsWith('6')) {
        if (!charges[c]) charges[c] = { compte: c, libelle: libelleCompte(c), montant: 0 };
        charges[c].montant += Number(e.debit || 0) - Number(e.credit || 0);
      }
      if (c.startsWith('7')) {
        if (!produits[c]) produits[c] = { compte: c, libelle: libelleCompte(c), montant: 0 };
        produits[c].montant += Number(e.credit || 0) - Number(e.debit || 0);
      }
    }
    const lignesCharges  = Object.values(charges).sort((a,b)=>a.compte.localeCompare(b.compte));
    const lignesProduits = Object.values(produits).sort((a,b)=>a.compte.localeCompare(b.compte));
    const totCharges  = lignesCharges.reduce((s,l)=>s+l.montant,0);
    const totProduits = lignesProduits.reduce((s,l)=>s+l.montant,0);
    const resultat    = totProduits - totCharges;

    return res.json({
      success: true, periode, debut, fin,
      charges: lignesCharges, produits: lignesProduits,
      totaux: { charges: totCharges, produits: totProduits, resultat },
    });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ── GET /reporting/tresorerie/:companyId ─────────────────────
app.get('/reporting/tresorerie/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const periode = req.query.periode || new Date().toISOString().slice(0, 7);
    const { debut, fin } = moisVersDateRange(periode);

    // Solde d'ouverture = tout avant le mois
    const { data: avant, error: errAvant } = await supabase
      .from('ecritures')
      .select('compte, debit, credit')
      .eq('company_id', companyId)
      .or('compte.like.52%,compte.like.57%,compte.like.53%')
      .lt('date_ecriture', debut);

    const soldOuv = (avant || []).reduce((s,e)=>s+Number(e.debit||0)-Number(e.credit||0),0);

    // Mouvements du mois
    const { data, error } = await supabase
      .from('ecritures')
      .select('compte, libelle, debit, credit, date_ecriture')
      .eq('company_id', companyId)
      .or('compte.like.52%,compte.like.57%,compte.like.53%')
      .gte('date_ecriture', debut)
      .lte('date_ecriture', fin)
      .order('date_ecriture', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const mouvements = (data || []).map(e => ({
      date:           e.date_ecriture,
      libelle:        e.libelle || libelleCompte(e.compte),
      compte:         e.compte,
      encaissement:   Number(e.debit  || 0),
      decaissement:   Number(e.credit || 0),
    }));

    const totEnc = mouvements.reduce((s,m)=>s+m.encaissement,0);
    const totDec = mouvements.reduce((s,m)=>s+m.decaissement,0);
    const soldFin = soldOuv + totEnc - totDec;

    return res.json({
      success: true, periode, debut, fin,
      solde_ouverture: soldOuv,
      mouvements,
      totaux: { encaissements: totEnc, decaissements: totDec },
      solde_cloture: soldFin,
    });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ── POST /reporting/commenter ─────────────────────────────────
// Génère un commentaire IA sur un rapport mensuel
app.post('/reporting/commenter', async (req, res) => {
  try {
    const { company_name, pays, periode, type, donnees } = req.body;
    if (!company_name || !periode || !type || !donnees)
      return res.status(400).json({ error: 'Champs obligatoires: company_name, periode, type, donnees' });

    const MODELE_LIGHT = process.env.CLAUDE_MODEL_LIGHT || 'claude-haiku-4-5-20251001';
    const tvaParPays = {CI:18,SN:18,CM:19.25,BJ:18,BF:18,ML:18,TG:18,NE:19,GA:18,CG:18,CD:16,GN:18};
    const tva = tvaParPays[pays] || 18;

    const prompts = {
      balance: `Tu es expert-comptable SYSCOHADA. Analyse cette balance générale de ${company_name} (${pays}, TVA ${tva}%) pour ${periode} et rédige un commentaire professionnel de 6-8 lignes. Signale les comptes déséquilibrés, les anomalies, et les points d'attention. Données: ${JSON.stringify(donnees).slice(0,1500)}`,
      resultat: `Tu es expert-comptable SYSCOHADA. Analyse ce compte de résultat de ${company_name} (${pays}) pour ${periode}. Commente la rentabilité, les charges dominantes, et donne 2-3 recommandations. Sois concis et professionnel (6-8 lignes). Données: ${JSON.stringify(donnees).slice(0,1500)}`,
      tresorerie: `Tu es expert-comptable SYSCOHADA. Analyse cette situation de trésorerie de ${company_name} (${pays}) pour ${periode}. Commente la liquidité, les flux importants, et alerte si solde critique. 6-8 lignes. Données: ${JSON.stringify(donnees).slice(0,1500)}`,
    };

    const prompt = prompts[type] || prompts.resultat;
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: MODELE_LIGHT,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
    const commentaire = response.data?.content?.[0]?.text || 'Commentaire indisponible.';
    return res.json({ success: true, commentaire });
  } catch(err) {
    return res.status(500).json({ error: err.message, commentaire: 'Commentaire IA indisponible — saisissez votre propre analyse.' });
  }
});

// ── POST /reporting/envoyer-rapport ──────────────────────────
// Envoie le rapport PDF par email à la PME
app.post('/reporting/envoyer-rapport', async (req, res) => {
  try {
    const { email_pme, company_name, periode, expert_name, cabinet_name, commentaire, pdf_html } = req.body;
    if (!email_pme || !pdf_html) return res.status(400).json({ error: 'email_pme et pdf_html obligatoires' });

    const emailService = require('./services/email.service');
    await emailService.envoyerRapportMensuel({
      emailDestinataire: email_pme,
      nomPME:            company_name || 'Votre entreprise',
      periode,
      nomExpert:         expert_name  || 'Votre expert-comptable',
      nomCabinet:        cabinet_name || 'Cabinet',
      commentaire:       commentaire  || '',
      pdfHtml:           pdf_html,
    });

    return res.json({ success: true, message: `Rapport envoyé à ${email_pme}` });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});


// ================================================================
// VÉRIFICATION VARIABLES AU DÉMARRAGE
// ================================================================
// (ajouté dans app.listen)

// ================================================================
// CINETPAY — Paiement abonnement
// ================================================================
const CINETPAY_API_URL_BASE = 'https://api-checkout.cinetpay.com/v2/payment';
const PLANS_CP = {
  tpe: { montant_ht: 12500, label: 'Plan TPE' },
  pme: { montant_ht: 25000, label: 'Plan PME' },
};
const TVA_PAYS = {CI:18,SN:18,CM:19.25,BJ:18,BF:18,ML:18,TG:18,NE:19,GA:18,CG:18,CD:16,GN:18};

app.post('/api/paiement/initier', async (req, res) => {
  try {
    const { company_id, plan, country, phone, moyen_paiement } = req.body;
    if (!company_id || !plan) return res.status(400).json({ error: 'company_id et plan obligatoires' });

    const planInfo  = PLANS_CP[plan.toLowerCase()] || PLANS_CP.pme;
    const taux      = TVA_PAYS[country] || 18;
    const montantHT  = planInfo.montant_ht;
    const montantTVA = Math.round(montantHT * taux / 100);
    const montantTTC = montantHT + montantTVA;
    const devise     = (country === 'CD') ? 'USD' : (country === 'GN') ? 'GNF' : 'XOF';

    const { data: company } = await supabase.from('companies')
      .select('company_name, email, country').eq('id', company_id).single();

    const transactionId = 'HCA-' + company_id.slice(0,8).toUpperCase() + '-' + Date.now();
    const appUrl = process.env.APP_URL || 'https://hcompta-ai.com';

    const cpPayload = {
      apikey:         process.env.CINETPAY_API_KEY,
      site_id:        process.env.CINETPAY_SITE_ID,
      transaction_id: transactionId,
      amount:         montantTTC,
      currency:       devise,
      description:    planInfo.label + ' H-Compta AI — ' + (company?.company_name || company_id),
      notify_url:     appUrl + '/api/paiement/notify',
      return_url:     appUrl + '/dashboard_pme_v3.html?paiement=success',
      channels:       moyen_paiement === 'cb' ? 'CREDIT_CARD' : 'MOBILE_MONEY',
      customer_name:  company?.company_name || 'PME',
      customer_email: company?.email || '',
      customer_phone_number: phone || '',
      customer_address: country || 'CI',
      customer_city:    country || 'CI',
      customer_country: country || 'CI',
      customer_state:   country || 'CI',
      customer_zip_code: '00000',
      lang: 'fr',
    };

    const cpRes = await axios.post(CINETPAY_API_URL_BASE, cpPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    const cpData = cpRes.data;
    if (cpData.code !== '201') {
      return res.status(500).json({ error: 'CinetPay: ' + (cpData.message || cpData.code) });
    }

    // Enregistrer la transaction
    try {
      await supabase.from('paiements').insert([{
        company_id, transaction_id: transactionId, plan,
        montant_ht: montantHT, montant_tva: montantTVA, montant_ttc: montantTTC,
        devise, status: 'pending',
        moyen: moyen_paiement || 'mobile_money',
        payment_url: cpData.data?.payment_url,
      }]);
    } catch(insErr) { console.warn('Insert paiement:', insErr.message); }

    return res.json({
      success: true,
      payment_url: cpData.data?.payment_url,
      transaction_id: transactionId,
      montant_ttc: montantTTC,
      devise,
    });
  } catch(err) {
    console.error('❌ CinetPay initier:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Erreur CinetPay: ' + (err.response?.data?.message || err.message) });
  }
});

app.post('/api/paiement/notify', async (req, res) => {
  try {
    const { cpm_trans_id, cpm_result, cpm_error_message, cpm_payid, payment_method } = req.body;
    console.log('📥 Webhook CinetPay:', { cpm_trans_id, cpm_result });
    if (cpm_result !== '00') {
      await supabase.from('paiements').update({ status: 'failed', error: cpm_error_message }).eq('transaction_id', cpm_trans_id);
      return res.json({ success: false });
    }
    const { data: paiement } = await supabase.from('paiements')
      .select('company_id, plan, montant_ttc').eq('transaction_id', cpm_trans_id).single();
    if (!paiement) return res.json({ success: false });
    await Promise.all([
      supabase.from('paiements').update({ status: 'paid', paid_at: new Date().toISOString(), cinetpay_id: cpm_payid, moyen: payment_method }).eq('transaction_id', cpm_trans_id),
      supabase.from('companies').update({ status: 'active', plan: paiement.plan, subscription_start: new Date().toISOString().slice(0,10), subscription_end: new Date(Date.now()+31*24*60*60*1000).toISOString().slice(0,10) }).eq('id', paiement.company_id),
    ]);
    try {
      const { data: co } = await supabase.from('companies').select('company_name,email').eq('id', paiement.company_id).single();
      if (co?.email) {
        const es = require('./services/email.service');
        await es.envoyerConfirmationPaiement({ emailDestinataire: co.email, nomPME: co.company_name, plan: paiement.plan.toUpperCase(), montant: Number(paiement.montant_ttc).toLocaleString('fr-FR'), devise: 'FCFA', transactionId: cpm_trans_id });
      }
    } catch(eErr) { console.error('Email confirm:', eErr.message); }
    return res.json({ success: true });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

app.get('/api/paiement/historique/:companyId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('paiements')
      .select('id,plan,montant_ttc,devise,status,moyen,paid_at,created_at,transaction_id')
      .eq('company_id', req.params.companyId).order('created_at', { ascending: false }).limit(12);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, paiements: data || [] });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

app.get('/api/paiement/verifier/:transactionId', async (req, res) => {
  try {
    const { data } = await supabase.from('paiements')
      .select('status,plan,montant_ttc,devise,paid_at').eq('transaction_id', req.params.transactionId).single();
    return res.json({ success: true, paiement: data });
  } catch(err) { return res.status(500).json({ error: err.message }); }
});

// ── ROUTE TEST EMAIL ─────────────────────────────────────────
app.post('/api/admin/test-email', async (req, res) => {
  try {
    const { email_dest } = req.body;
    if (!email_dest) return res.status(400).json({ error: 'email_dest obligatoire' });
    const config = {
      BREVO_API_KEY:    process.env.BREVO_API_KEY ? 'OK (' + process.env.BREVO_API_KEY.slice(0,8) + '...)' : 'MANQUANTE',
      BREVO_FROM_EMAIL: process.env.BREVO_FROM_EMAIL || 'noreply@hcompta-ai.com (defaut)',
    };
    if (!process.env.BREVO_API_KEY) return res.status(500).json({ error: 'BREVO_API_KEY manquante', config });
    let senders = [];
    try {
      const sr = await axios.get('https://api.brevo.com/v3/senders', { headers: { 'api-key': process.env.BREVO_API_KEY }, timeout: 5000 });
      senders = (sr.data?.senders || []).map(s => s.email + (s.active ? ' (actif)' : ' (inactif)'));
    } catch(se) { senders = ['erreur: ' + se.message]; }
    config.EXPEDITEURS_BREVO = senders;
    const emailService = require('./services/email.service');
    await emailService.envoyerEmail({ to: email_dest, subject: '[H-Compta AI] Test email ' + new Date().toLocaleString('fr-FR'), htmlContent: '<p>Test OK depuis Render · ' + new Date().toISOString() + '</p>' });
    return res.json({ success: true, message: 'Email envoyé à ' + email_dest, config });
  } catch(err) {
    return res.status(500).json({ error: 'Echec Brevo', detail: JSON.stringify(err.response?.data || err.message), status: err.response?.status, config: { BREVO_API_KEY: process.env.BREVO_API_KEY ? 'OK' : 'MANQUANTE', BREVO_FROM_EMAIL: process.env.BREVO_FROM_EMAIL || 'non defini' } });
  }
});


const PORT = process.env.PORT || 3000;
// ── ROUTE TEST EMAIL — diagnostic Brevo ─────────────────────
app.post('/api/admin/test-email', async (req, res) => {
  try {
    const { email_dest } = req.body;
    if (!email_dest) return res.status(400).json({ error: 'email_dest obligatoire' });

    // Vérifier les variables d'env
    const config = {
      BREVO_API_KEY:   process.env.BREVO_API_KEY ? '✅ Définie (' + process.env.BREVO_API_KEY.slice(0,8) + '...)' : '❌ MANQUANTE',
      BREVO_FROM_EMAIL: process.env.BREVO_FROM_EMAIL || '❌ MANQUANTE (défaut: noreply@hcompta-ai.com)',
      BREVO_FROM_NAME:  process.env.BREVO_FROM_NAME  || '❌ MANQUANTE (défaut: H-Compta AI)',
    };

    if (!process.env.BREVO_API_KEY) {
      return res.status(500).json({ error: 'BREVO_API_KEY non configurée sur Render', config });
    }

    // Tenter l'envoi d'un email de test
    const emailService = require('./services/email.service');
    await emailService.envoyerEmail({
      to:          email_dest,
      subject:     '[H-Compta AI] Email de test — ' + new Date().toLocaleString('fr-FR'),
      htmlContent: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:32px auto;padding:24px;background:#F2FAF6;border-radius:12px">'
        + '<h2 style="color:#0D2B22">✅ Email de test H-Compta AI</h2>'
        + '<p style="color:#2D3A35">Brevo fonctionne correctement. Cet email confirme que votre configuration est opérationnelle.</p>'
        + '<p style="font-size:12px;color:#9DB8AC">Envoyé depuis Render · ' + new Date().toISOString() + '</p></div>',
    });

    return res.json({ success: true, message: 'Email de test envoyé à ' + email_dest, config });
  } catch(err) {
    const detail = err.response?.data || err.message;
    return res.status(500).json({
      error:   'Échec envoi Brevo',
      detail:  JSON.stringify(detail),
      status:  err.response?.status,
      config: {
        BREVO_API_KEY:   process.env.BREVO_API_KEY ? '✅ Définie' : '❌ MANQUANTE',
        BREVO_FROM_EMAIL: process.env.BREVO_FROM_EMAIL || 'non définie',
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`H-Compta AI Backend running on port ${PORT} 🚀`);
  // Vérification des variables critiques au démarrage
  const critiques = ['BREVO_API_KEY','BREVO_FROM_EMAIL','CLAUDE_API_KEY','SUPABASE_URL','SUPABASE_KEY'];
  critiques.forEach(v => {
    if (!process.env[v]) console.warn(`⚠️  Variable manquante : ${v}`);
    else console.log(`✅ ${v} : configurée`);
  });
});
