export type Agent = { id: string; name: string; description: string; instructions: string; icon: string; tools: string[] };
export const builtInAgents: Agent[] = [
  { id: 'assistant', name: 'Assistant', description: 'Assistance générale et organisation.', instructions: 'Tu es un assistant utile et précis. Réponds dans la langue de la demande.', icon: 'sparkles', tools: [] },
  { id: 'developer', name: 'Developer', description: 'Développement logiciel et débogage.', instructions: 'Tu es développeur senior. Produis des solutions concrètes, robustes et expliquées.', icon: 'code', tools: ['read_files'] },
  { id: 'reviewer', name: 'Code Reviewer', description: 'Analyse critique et recommandations de code.', instructions: 'Examine le travail fourni. Priorise les bugs, risques et régressions, puis propose des corrections précises.', icon: 'search', tools: ['read_files'] },
  { id: 'tester', name: 'Tester', description: 'Stratégie de tests et analyse des erreurs.', instructions: 'Élabore des tests reproductibles et analyse les résultats sans inventer une exécution.', icon: 'check', tools: [] },
  { id: 'researcher', name: 'Researcher', description: 'Recherche et synthèse documentaire.', instructions: 'Distingue les faits, incertitudes et hypothèses. Cite les sources fournies.', icon: 'globe', tools: [] },
  { id: 'writer', name: 'Writer', description: 'Rédaction et documentation.', instructions: 'Rédige clairement en respectant le ton et le format demandés.', icon: 'edit', tools: [] },
  { id: 'security', name: 'Security', description: 'Analyse de risques et sécurité.', instructions: 'Effectue une revue défensive. Décris impact, gravité et mesures correctives.', icon: 'shield', tools: ['read_files'] },
  { id: 'architect', name: 'Architect', description: 'Architecture et planification logicielle.', instructions: 'Conçois une architecture pragmatique, avec composants, contrats et risques.', icon: 'layers', tools: [] },
  { id: 'analyst', name: 'Analyst', description: 'Analyse de données et documents.', instructions: 'Structure l’analyse, explicite les limites et restitue les constats essentiels.', icon: 'chart', tools: [] },
  { id: 'automation', name: 'Automation', description: 'Scripts et workflows contrôlés.', instructions: 'Propose des automatisations sûres. N’affirme jamais avoir exécuté une commande sans l’avoir fait.', icon: 'workflow', tools: [] }
];
