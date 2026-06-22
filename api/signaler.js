// Variable globale de stockage temporaire en mémoire Vercel
let bddTemporaire = [];

export default function handler(req, res) {
    // 1. Configuration des en-têtes de sécurité et règles de partage CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Gestion de la pré-vérification de sécurité du navigateur (Preflight Request)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. Traitement de la requête POST envoyée par votre fichier index.html
    if (req.method === 'POST') {
        const { numero, motif } = req.body;
        
        // Vérification de sécurité de la requête
        if (!numero) {
            return res.status(400).json({ error: "Le paramètre numéro est manquant." });
        }

        // Nettoyage des espaces éventuels dans le numéro
        const numClean = numero.replace(/\s+/g, '');
        
        // Recherche dans notre registre virtuel
        let cible = bddTemporaire.find(i => i.numero_telephone === numClean);

        if (cible) {
            cible.nombre_actions += 1;
        } else {
            cible = { 
                numero_telephone: numClean, 
                nombre_actions: 1 
            };
            bddTemporaire.push(cible);
        }

        // Renvoi de la confirmation de succès à votre page web
        return res.status(200).json({ 
            success: true, 
            total: cible.nombre_actions 
        });
    }

    // Sécurité : Bloquer toutes les autres méthodes de requêtes (GET, PUT, etc.)
    return res.status(405).json({ error: "Méthode réseau non autorisée." });
}
  
