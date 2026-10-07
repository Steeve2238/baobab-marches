import "./globals.css";
import { LanguageProvider } from "../lib/i18n/LanguageContext";

export const metadata = {
  title: "Baobab Marches",
  description: "L'ecosysteme complet de pilotage des marches publics et prives",
  authors: [{ name: "YMS Groupe" }],
  creator: "YMS Groupe",
  publisher: "YMS Groupe",
  other: { copyright: `© ${new Date().getFullYear()} YMS Groupe - Baobab Marchés. Tous droits réservés.` },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
        <footer className="mention-copyright" role="contentinfo">
          © {new Date().getFullYear()} YMS Groupe - Baobab Marchés. Tous droits réservés. Logiciel protégé par le droit d&apos;auteur ; toute reproduction, extraction ou rétro-ingénierie non autorisée est interdite et passible de poursuites.
        </footer>
      </body>
    </html>
  );
}
