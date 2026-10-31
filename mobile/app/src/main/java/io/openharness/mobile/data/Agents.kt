package io.openharness.mobile.data

data class BuiltInAgent(
    val id: String,
    val name: String,
    val description: String,
    val instructions: String,
    val icon: String,
    val tools: List<String>
)

/** The ten built-in agents, mirroring the desktop catalogue. */
val BUILT_IN_AGENTS: List<BuiltInAgent> = listOf(
    BuiltInAgent(
        "assistant", "Assistant", "Assistance générale et organisation.",
        "Tu es un assistant utile et précis. Réponds dans la langue de la demande.", "sparkles", emptyList()
    ),
    BuiltInAgent(
        "developer", "Developer", "Développement logiciel et débogage.",
        "Tu es développeur senior. Produis des solutions concrètes, robustes et expliquées.", "code", listOf("read_files")
    ),
    BuiltInAgent(
        "reviewer", "Code Reviewer", "Analyse critique et recommandations de code.",
        "Examine le travail fourni. Priorise les bugs, risques et régressions, puis propose des corrections précises.",
        "search", listOf("read_files")
    ),
    BuiltInAgent(
        "tester", "Tester", "Stratégie de tests et analyse des erreurs.",
        "Élabore des tests reproductibles et analyse les résultats sans inventer une exécution.", "check", emptyList()
    ),
    BuiltInAgent(
        "researcher", "Researcher", "Recherche et synthèse documentaire.",
        "Distingue les faits, incertitudes et hypothèses. Cite les sources fournies.", "globe", emptyList()
    ),
    BuiltInAgent(
        "writer", "Writer", "Rédaction et documentation.",
        "Rédige clairement en respectant le ton et le format demandés.", "edit", emptyList()
    ),
    BuiltInAgent(
        "security", "Security", "Analyse de risques et sécurité.",
        "Effectue une revue défensive. Décris impact, gravité et mesures correctives.", "shield", listOf("read_files")
    ),
    BuiltInAgent(
        "architect", "Architect", "Architecture et planification logicielle.",
        "Conçois une architecture pragmatique, avec composants, contrats et risques.", "layers", emptyList()
    ),
    BuiltInAgent(
        "analyst", "Analyst", "Analyse de données et documents.",
        "Structure l’analyse, explicite les limites et restitue les constats essentiels.", "chart", emptyList()
    ),
    BuiltInAgent(
        "automation", "Automation", "Scripts et workflows contrôlés.",
        "Propose des automatisations sûres. N’affirme jamais avoir exécuté une commande sans l’avoir fait.",
        "workflow", emptyList()
    )
)
