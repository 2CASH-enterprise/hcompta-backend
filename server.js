// H-Compta AI — Backend Node.js branché sur les vraies tables Supabase
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage() });
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const supabase = require('./config/supabase');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/pieces',     require('./routes/pieces.routes'));
app.use('/api/tva',        require('./routes/tva.routes'));
app.use('/api/export',     require('./routes/export.routes'));
app.use('/api/mariah',     require('./routes/mariah.routes'));
app.use('/api/traitement', require('./routes/traitement.routes'));
app.use('/api/learning',   require('./routes/learning.routes'));

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
  CD:{taux:16,label:'RD Congo',devise:'CDF'},
  GN:{taux:18,label:'Guinée',devise:'GNF'},
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
    const {error:sErr} = await supabase.storage.from('pieces').upload(path,file.buffer,{contentType:file.mimetype,upsert:false});
    if(sErr) return res.status(500).json({error:'Stockage: '+sErr.message});
    const {data:urlData} = supabase.storage.from('pieces').getPublicUrl(path);
    const fileUrl = urlData?.publicUrl||path;
    const {data:piece,error:dErr} = await supabase.from('pieces')
      .insert([{company_id,uploaded_by:uploaded_by||'1d085e85-dfe2-46db-82d2-b7a57b7afc2a',file_url:fileUrl,file_name:file.originalname,status:'uploaded'}])
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
    const planPrix = {tpe:12500,pme:25000,enterprise:75000};
    const montant  = planPrix[plan.toLowerCase()]||25000;
    const trialEnd = new Date(); trialEnd.setDate(trialEnd.getDate()+30);
    const {data:user,error:e1} = await supabase.from('users').insert([{email:email.toLowerCase(),full_name:full_name||company_name,phone:phone||null,role:'PME_OWNER',country:pays.toUpperCase()}]).select().single();
    if(e1) return res.status(500).json({error:e1.message});
    const {data:company,error:e2} = await supabase.from('companies').insert([{company_name,email:email.toLowerCase(),rccm,country:pays.toUpperCase(),vat_rate:paysInfo.taux,plan:plan.toLowerCase(),subscription_amount_ht_fcfa:montant,trial_start_date:new Date().toISOString().slice(0,10),trial_end_date:trialEnd.toISOString().slice(0,10),owner_user_id:user.id,ambassador_id:ambassadorId,promo_code_used:code_promo?code_promo.toUpperCase():null,status:'trial'}]).select().single();
    if(e2) return res.status(500).json({error:e2.message});
    await supabase.from('company_users').insert([{company_id:company.id,user_id:user.id,role_in_company:'OWNER',status:'active'}]);
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
    const redirectMap = {PME_OWNER:'/dashboard-pme',COLLABORATOR:'/dashboard-pme',EXPERT:'/dashboard-expert',AMBASSADOR:'/dashboard-ambassadeur',ADMIN:'/dashboard-admin'};
    return res.json({success:true,user_id:user.id,email:user.email,full_name:user.full_name,role:user.role,country:user.country,company,redirect:redirectMap[user.role]||'/dashboard-pme'});
  } catch(err){return res.status(500).json({error:err.message});}
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

    const {data, error} = await supabase.from('invites').insert([{
      company_id,
      email:      email.toLowerCase(),
      role,
      token,
      status:     'pending',
      expires_at: expires_at || new Date(Date.now() + 7*24*60*60*1000).toISOString(),
      invited_by: invited_by || null,
    }]).select().single();

    if (error) return res.status(500).json({error: error.message});

    // TODO: envoyer un email avec le lien d'invitation
    // Le lien serait : https://hcompta-ai.com/accepter-invitation?token=xxx

    return res.json({
      success: true,
      message: `Invitation envoyée à ${email}`,
      token,
      invite: data,
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
app.get('/blog', async (req,res) => {
  try {
    const {country} = req.query;
    let query = supabase.from('blog_posts').select('id,title,slug,excerpt,cover_image_url,country,published_at').eq('is_published',true).order('published_at',{ascending:false}).limit(10);
    if(country) query = query.or(`country.eq.${country},country.is.null`);
    const {data,error} = await query;
    if(error) return res.status(500).json({error:error.message});
    return res.json(data||[]);
  } catch(err){return res.status(500).json({error:err.message});}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`H-Compta AI Backend running on port ${PORT} 🚀`));
