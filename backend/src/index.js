require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const dossiersRoutes = require("./routes/dossiers");
const chronogrammeRoutes = require("./routes/chronogramme");
const signauxRoutes = require("./routes/signaux");
const regleRoutes = require("./routes/regles");
const financementRoutes = require("./routes/financement");
const margeRoutes = require("./routes/marge");
const logistiqueRoutes = require("./routes/logistique");
const courriersRoutes = require("./routes/courriers");
const parametresRoutes = require("./routes/parametres");
const fournisseursRoutes = require("./routes/fournisseurs");
const extractionRoutes = require("./routes/extraction");
const rolesRoutes = require("./routes/roles");
const utilisateursRoutes = require("./routes/utilisateurs");
const maitresOuvrageRoutes = require("./routes/maitresOuvrage");
const concurrenceRoutes = require("./routes/concurrence");
const parcAutoRoutes = require("./routes/parcAuto");
const rhRoutes = require("./routes/rh");
const superAdminRoutes = require("./routes/superAdmin");
const ventesRoutes = require("./routes/ventes");
const { t } = require("./utils/i18n");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "baobab-marches-backend",
  });
});

// ---------------------------------------------------------------------------
// TEMPORAIRE - A RETIRER : diagnostic de l'envoi SMTP (mot de passe oublie,
// 06/09/2026). Meme principe que le diagnosticEnv utilise pour l'incident de
// redirection 307 : les logs Passenger ne sont pas accessibles en SSH sur cet
// hebergement, donc on renvoie l'erreur exacte directement dans la reponse
// JSON plutot que de chercher un fichier de log introuvable. A retirer des
// que le probleme est identifie.
// Usage : GET /api/diagnostic-smtp?email=une_adresse_a_toi@... (attention :
// l'appel envoie reellement un email de test a cette adresse si tout marche)
// ---------------------------------------------------------------------------
app.get("/api/diagnostic-smtp", async (req, res) => {
  const { envoyerEmailReinitialisation } = require("./utils/mailer");
  try {
    await envoyerEmailReinitialisation({
      destinataire: req.query.email || process.env.SMTP_USER,
      prenom: "Test",
      lienReinitialisation: "https://exemple.com/diagnostic",
    });
    res.json({ success: true, message: "Email envoye sans erreur." });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/dossiers", dossiersRoutes);
app.use("/api/chronogramme", chronogrammeRoutes);
app.use("/api/signaux", signauxRoutes);
app.use("/api/regles", regleRoutes);
app.use("/api/financement", financementRoutes);
app.use("/api/marge", margeRoutes);
app.use("/api/logistique", logistiqueRoutes);
app.use("/api/courriers", courriersRoutes);
app.use("/api/parametres", parametresRoutes);
app.use("/api/fournisseurs", fournisseursRoutes);
app.use("/api/extraction", extractionRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/utilisateurs", utilisateursRoutes);
app.use("/api/maitres-ouvrage", maitresOuvrageRoutes);
app.use("/api/concurrence", concurrenceRoutes);
app.use("/api/parc-auto", parcAutoRoutes);
app.use("/api/rh", rhRoutes);
app.use("/api/super-admin", superAdminRoutes);
app.use("/api/ventes", ventesRoutes);

// Gestionnaire d'erreur generique (dernier recours)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: t(req, "SERVER_ERROR") });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Baobab Marches API demarree sur le port ${PORT}`);
});
