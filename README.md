# Product Sheet Validator

Ce petit outil en Node.js vérifie automatiquement que les pages produits disposent bien des fiches PDF attendues (sécurité + technique).

## Pré-requis

1. **Git** (pour récupérer le projet).
2. **Node.js** (version récente 18+ conseillée).
3. **npm** (généralement fourni avec Node).
4. Avoir un fichier CSV d’entrée contenant une colonne `URL`.

## Récupérer le projet

Si tu n'as pas encore les sources, clone simplement le dépôt :

```bash
git clone https://github.com/ton-organisation/product-sheet-validator.git
cd product-sheet-validator
```

## Installation

Dans le dossier du projet :

```bash
npm install
```

## Préparer les fichiers

- Place ton CSV d’entrée dans `input/` (exemple : `input/products.csv`).
- Le script génère un fichier CSV de sortie dans `output/`.

## Lancer la vérification

Commande standard (lit `input/products.csv`, écrit `output/results.csv`) :

```bash
npm start
```

Pour utiliser un autre fichier :

```bash
npm start -- --input chemin/vers/mon-fichier.csv --output chemin/vers/mes-resultats.csv
```

> Astuce : le `--` avant `--input` est obligatoire pour transmettre les options au script TypeScript.

## Résultat

Un CSV est produit avec trois colonnes :

- `URL`
- `result` (`OK` ou `KO`)
- `comments` (liste des points à corriger si `KO`)

Chaque URL est également loguée dans le terminal pendant l’exécution.

## Dépannage rapide

- **npm introuvable** : installe Node.js via [nodejs.org](https://nodejs.org/).
- **Problème d’accès réseau** : vérifie ta connexion internet et les éventuels blocages par un proxy ou un VPN.
- **Aucune colonne `URL` détectée** : ouvre ton CSV et assure-toi que l’en-tête contient exactement `URL` (majuscules). Ajoute-la si nécessaire.

Bon contrôle !
