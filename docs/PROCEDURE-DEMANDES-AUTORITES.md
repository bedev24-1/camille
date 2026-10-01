# Procédure de réponse aux demandes des autorités publiques

**ETS BUYTICLE** — RCCM CM-DLA-01-2025-A10-01482
Bonamoussadi, Douala — Cameroun · contact@buyticle.com

| | |
|---|---|
| **Version** | 1.0 |
| **Adoptée le** | 1er octobre 2026 |
| **Responsable** | Le gérant d'ETS BUYTICLE |
| **Révision** | annuelle, ou à la première demande reçue |

---

## 1. Pourquoi cette procédure existe

Camille détient les **conversations, numéros de téléphone et adresses de
livraison des clients de ses commerçants abonnés**. Ce ne sont pas nos données,
ni même celles de nos clients : ce sont celles des clients de nos clients.

Une personne nous les a confiées en écrivant à un commerçant, pas à nous. Les
remettre à un tiers — même à une autorité, même de bonne foi — est un acte
grave qui engage ETS BUYTICLE devant ce commerçant et devant cette personne.

Cette procédure existe pour que la réponse à une telle demande ne dépende ni de
l'heure, ni de l'interlocuteur, ni du sang-froid de celui qui décroche.

**Elle s'applique à toute demande émanant d'une autorité publique** : police,
gendarmerie, parquet, juge d'instruction, administration, régulateur, service de
renseignement — camerounaise ou étrangère.

Elle ne s'applique pas aux demandes d'un commerçant abonné concernant ses
propres données, qui relèvent du support courant.

---

## 2. Qui décide

**Le gérant d'ETS BUYTICLE, et lui seul.**

Aucun salarié, prestataire, développeur ou administrateur système n'est autorisé
à extraire ou transmettre des données en réponse à une demande d'autorité, quelle
que soit l'insistance de l'interlocuteur.

Toute personne de l'équipe qui reçoit une telle demande applique une règle
unique : **elle ne confirme rien, ne nie rien, ne cherche rien, et transmet au
gérant.** Formule à utiliser :

> « Je ne suis pas habilité à traiter cette demande. Adressez-la par écrit à
> contact@buyticle.com, elle sera examinée sans délai. »

Cette règle protège aussi le salarié : il n'a jamais à juger seul de la légalité
d'une réquisition.

---

## 3. Examen de la légalité — avant toute recherche

Aucune donnée n'est recherchée, extraite ou consultée avant la fin de cet
examen. Chercher d'abord et vérifier ensuite, c'est avoir déjà cédé.

### 3.1 Aucune demande verbale n'est honorée

Un appel téléphonique, un message WhatsApp, une visite sans document, une
demande sur les réseaux sociaux : **jamais de réponse sur le fond.** L'auteur est
invité à écrire.

Cette règle est absolue. L'usurpation de qualité d'officier est le moyen le plus
simple d'obtenir des données, et le téléphone ne permet aucune vérification.

### 3.2 Ce que le document doit comporter

Une demande est examinée au fond si et seulement si elle est écrite et porte :

1. l'**identité et la qualité** de son auteur (nom, grade ou fonction, service) ;
2. une **signature** et le cachet du service ;
3. une **référence de procédure** — numéro de réquisition, de procès-verbal ou
   de dossier ;
4. le **fondement juridique** invoqué ;
5. l'**objet précis** : quelles données, sur quelle personne, pour quelle
   période.

Si l'un de ces éléments manque, le gérant le demande par écrit avant tout examen
au fond. Une demande incomplète n'est pas refusée : elle est suspendue.

### 3.3 Vérification de l'auteur

Le gérant vérifie que le service existe et que l'auteur y exerce, en rappelant
le service **par un numéro obtenu indépendamment** — annuaire officiel, site de
l'administration — et jamais par le numéro indiqué dans la demande.

### 3.4 Appréciation du fondement

Le gérant apprécie si la demande repose sur un fondement légal applicable.
Au Cameroun, les demandes relatives aux données électroniques s'inscrivent
ordinairement dans le cadre des réquisitions judiciaires prévues par le Code de
procédure pénale, et des textes sur la cybersécurité et les communications
électroniques.

> **À faire valider par un conseil juridique camerounais.** Les références
> précises des textes et les formes exactes des réquisitions doivent être
> confirmées par un avocat. Cette procédure décrit notre conduite ; elle ne
> prétend pas dire le droit.

---

## 4. Minimisation — ne donner que ce qui est demandé

C'est le point où une petite entreprise fait le plus de dégâts, parce que
l'export large est plus rapide que l'extraction précise.

**Règle : on transmet la réponse à la question posée, jamais le contenant.**

| Demandé | Transmis | Jamais transmis |
|---|---|---|
| L'adresse de livraison d'une commande | cette adresse, cette commande | la table `orders`, les autres commandes du même client |
| Les échanges avec un numéro sur une période | ces messages, sur cette période | la conversation entière, les autres contacts du commerçant |
| L'identité du titulaire d'un compte | les champs demandés | le mot de passe, les jetons, la base des utilisateurs |

Trois interdits permanents, même sur demande écrite et fondée :

- **aucun accès direct** à la base de données, au serveur ou au tableau de bord
  n'est ouvert à un tiers ; l'extraction est faite par nous, et nous seuls ;
- **aucun secret** n'est transmis — mots de passe, clés d'API, jetons d'accès ;
- **aucune donnée d'un tiers** non visé par la demande ne figure dans l'export.
  Si un fichier mêle plusieurs personnes, il est expurgé avant transmission.

L'export est relu par le gérant avant envoi, ligne par ligne, pour vérifier
qu'aucune donnée hors périmètre n'y figure.

---

## 5. Contestation d'une demande illégale

**Refuser est une option prévue, pas une audace individuelle.**

Le gérant refuse par écrit, en motivant, lorsque la demande :

- n'indique aucun fondement juridique, ou un fondement manifestement inapplicable ;
- émane d'une personne dont la qualité n'a pu être vérifiée ;
- est **disproportionnée** — par exemple l'accès à l'ensemble des clients, ou à
  des données sans lien avec l'objet annoncé ;
- porte sur des données que nous ne détenons pas ;
- exige un accès direct à nos systèmes.

Le refus est notifié à l'auteur, par écrit, avec son motif, et consigné au
registre. En cas d'insistance ou de menace, le gérant saisit un avocat avant
toute transmission. **Le doute se résout par le conseil juridique, jamais par la
remise des données.**

---

## 6. Information du commerçant concerné

Les données visées sont celles des clients d'un commerçant abonné. Celui-ci est
**informé de la demande et de notre réponse**, sauf lorsque la loi ou la décision
elle-même l'interdit expressément.

Lorsque la notification est interdite, ce fait et son fondement sont consignés au
registre, et le commerçant est informé dès que l'interdiction cesse.

---

## 7. Registre des demandes

Toute demande — **y compris celles refusées, suspendues ou retirées** — est
consignée. Le registre est tenu par le gérant, conservé hors du système de
production, et sauvegardé.

Colonnes obligatoires :

| Champ | Contenu |
|---|---|
| Date de réception | jour et heure |
| Canal | courrier, remise en main propre, e-mail |
| Auteur | nom, qualité, service |
| Référence | numéro de réquisition ou de dossier |
| Fondement invoqué | tel qu'écrit par l'auteur |
| Objet | données et personnes visées, période |
| Décision | transmis / refusé / suspendu / retiré |
| Motif de la décision | en une phrase |
| Données transmises | liste exacte des champs et enregistrements |
| Décidé par | le gérant |
| Date de réponse | |
| Commerçant informé | oui / non, et pourquoi |

Le registre est conservé **dix ans**. Ce n'est pas une formalité : c'est la seule
pièce qui établit, le jour où une personne nous reproche la divulgation de ses
données, que nous avons agi dans un cadre légal et dans la limite du nécessaire.

---

## 8. Ce que cette procédure engage

En adoptant ce document, ETS BUYTICLE déclare avoir mis en place :

- un **examen obligatoire de la légalité** de toute demande, préalable à toute
  recherche de données (§ 3) ;
- des **dispositions pour contester** les demandes jugées illégales, y compris
  par voie juridique (§ 5) ;
- une **politique de minimisation** limitant la transmission au strict
  nécessaire (§ 4) ;
- une **documentation** de chaque demande, de la réponse apportée, du fondement
  invoqué et des personnes impliquées (§ 7).

---

*Adoptée par le gérant d'ETS BUYTICLE le 1er octobre 2026. Les références
juridiques du § 3.4 restent à confirmer par un conseil juridique camerounais ;
la conduite décrite, elle, s'applique dès aujourd'hui.*
