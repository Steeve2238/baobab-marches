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
const { t } = require("./utils/i18n");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "baobab-marches-backend" });
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

// Gestionnaire d'erreur generique (dernier recours)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: t(req, "SERVER_ERROR") });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Baobab Marches API demarree sur le port ${PORT}`);
});
