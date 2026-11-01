# Environnements virtuels d'équipe (PC virtuel)

Une équipe peut se voir assigner un **environnement virtuel** : un PC virtuel
propre à l'équipe, constitué d'un espace de travail isolé et d'un bureau web
ouvrable dans une fenêtre dédiée.

## Qu'est-ce que c'est

- **Espace isolé** : la machine vit dans les données protégées de
  l'application (`userData/vm-environments/<id>`), avec `Desktop/`,
  `Documents/`, `Downloads/` et un `README.txt`. Rien de ce que les agents y
  écrivent ne sort de ce dossier.
- **Bureau web** : chaque machine possède un `bureau.html` (généré, sans
  ressource externe) qui présente la machine et ses raccourcis. Il s'ouvre
  depuis la vue Équipe ou Paramètres dans une fenêtre Electron séparée, sans
  accès Node, et ne navigue jamais hors de la page locale.
- **Raccourcis web** : les URLs http(s) configurées à la création apparaissent
  sur le bureau ; chacune s'ouvre dans une fenêtre « web de la machine » dont
  la navigation est restreinte aux hôtes configurés, avec une session
  persistante propre �� la machine (`persist:vme-<id>`).

## Ce que peuvent faire les agents

Quand une équipe possède une machine, l'introduction de mission/tchat décrit la
machine et les marqueurs disponibles. Les agents agissent par lignes
complètes dans leurs réponses, exécutées par le processus principal :

| Marqueur | Effet |
| --- | --- |
| `VM_LS: sous/dossier` | Liste le contenu (racine si vide) |
| `VM_READ: chemin/relatif.ext` | Lit un fichier texte (64 Ko max) |
| `VM_WRITE: chemin/relatif.ext | contenu` | Crée/remplace un fichier (512 Ko max, `\n`/`\t` échappés) |
| `VM_MKDIR: sous/dossier` | Crée un dossier (parents inclus) |
| `VM_DELETE: chemin/relatif` | Supprime un fichier ou un dossier vide |
| `VM_RUN: programme arguments` | Lance une commande (bascule d'équipe requise) |
| `VM_RUN_WAIT: programme arguments | sous/dossier` | Attend la fin, donne le code de sortie (120 s max) |

Chaque résultat revient à l'agent sous forme étiquetée (`VM_FILE_CONTENT`,
`VM_WRITE_RESULT`, `VM_RUN_RESULT`…) dans le même tour (3 tours, 8 actions par
tour). Une bascule d'équipe (« Autoriser les commandes dans l'environnement
virtuel ») gate la famille `VM_RUN*` indépendamment de la bascule RUN des
dossiers assignés.

## Confinement

- Les chemins doivent être relatifs ; `..` est toléré tant que la cible
  résolue (résolution lexicale + realpath, liens symboliques inclus) reste
  dans la machine.
- Les programmes de `VM_RUN` sont des noms du PATH de l'hôte ou des chemins
  internes à la machine ; les arguments ressemblant à des chemins hors machine
  sont refusés ; pas d'interprétation shell (les caractères `& | ; < >`
  sont interdits, seul `.bat`/`.cmd` passe par cmd.exe).
- Les refus remontent à l'agent comme texte étiqueté, jamais de contenu hors
  machine.

## Gestion (Paramètres → Environnements virtuels)

- **Créer** : un nom et, optionnellement, des raccourcis (une URL par ligne,
  `Nom | https://…` accepté).
- **Ouvrir** : bureau web de la machine ; **Web** : premier raccourci.
- **Assigner** : dans Paramètres → Équipes, chaque équipe choisit sa machine
  (une machine n'appartient qu'à une équipe).
- **Supprimer** : uniquement si la machine n'est assignée à aucune équipe ;
  supprime la ligne et son espace isolé. Supprimer l'équipe détache la machine
  (elle survit, non assignée).

## Limites connues

- La machine n'est pas un hyperviseur : c'est un espace de travail isolé et un
  bureau web, pas un second système d'exploitation. Les commandes s'exécutent
  avec les outils disponibles sur l'hôte (node, python…), confinées au dossier
  de la machine.
- Le navigateur de la machine est une fenêtre de navigation restreinte aux
  hôtes configurés ; les agents ne le pilotent pas (pas de marqueur de clic/
  scrape) — ils raisonnent sur le web avec leurs propres connaissances.
