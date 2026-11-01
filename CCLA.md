# Voxarium Contributor License Agreement (corporate)

Version 1.0

> **DRAFT: not yet reviewed by a lawyer.** It is modelled on the Apache Software
> Foundation Corporate CLA and works together with the individual
> [Voxarium CLA](CLA.md). Items marked **[COUNSEL]** need a qualified lawyer's input.

Use this agreement when your company, employer or other organization ("**Company**") has,
or may have, rights in work that its employees or contractors contribute to Voxarium.

All defined terms (Maintainer, Successor, Project, Contribution, Open License) and all
grants, promises and commitments in the individual [Voxarium CLA](CLA.md) (version 2.0 or
later) apply to the Company as if the Company were the contributor. That includes the
copyright license (Section 1.1 and 1.2), the patent license (Section 1.3), the Open Source
Commitment (Section 2), and the promises about third-party work and voice and model data
(Section 3). Where this agreement and the individual CLA conflict about the Company,
this agreement controls.

## 1. Grant

The Company grants the Maintainer and every recipient of the Project the licenses described
in Sections 1.1, 1.2 and 1.3 of the CLA for every Contribution made by the Company's
Designated Employees, whether made before or after the Company signs.

## 2. Designated Employees

1. The Company will list the GitHub usernames of the employees and contractors who are
   authorized to contribute on its behalf ("**Designated Employees**") in the signature
   comment or in a written notice to the Maintainer.
2. The Company may add or remove Designated Employees by written notice to the Maintainer
   through a GitHub issue or pull request. A removal applies from the date of notice and does
   not affect licenses already granted for Contributions made before then.
3. A Designated Employee still signs the individual CLA for any rights they hold personally.

## 3. Company promises

The Company confirms that:

1. It is a legal entity with the authority to sign this agreement, and the person who signs
   for it is authorized to bind it.
2. It has the right to grant the licenses in Section 1, and it has obtained any waiver or
   permission needed from the Designated Employees and other third parties.
3. Each Contribution is the original work of the Designated Employee or is identified as
   third-party work under Section 3.3 of the CLA. To the Company's knowledge it does not
   violate anyone's rights.
4. It will tell the Maintainer promptly if any of this stops being true.
5. It has given each Designated Employee a copy of Section 3.5 of the CLA (voice and model
   data) and will not have them submit such material without the required consent.

## 4. Moral rights, privacy, versions and general terms

Section 1.4 (moral rights), Section 5 (public record and personal data), Section 6 (versions
and changes) and Section 7 (general, including governing law and courts) of the CLA apply to
this agreement **[COUNSEL]**. The Company acknowledges that the names and GitHub usernames of
its Designated Employees will be kept in a public signature file.

## 5. How to sign

Until the project has an automated flow for companies, a Company signs by an authorized
person opening a pull request that adds a line to `signatures/corporate.md` on the
`cla-signatures` branch with:

- the Company's legal name and country of registration,
- the name and title of the person signing,
- the GitHub usernames of the Designated Employees,
- the sentence:

> I am authorized to sign for the Company and I hereby sign the Voxarium Corporate CLA

The Maintainer confirms the signature by commenting on that pull request, and the CLA bot
allowlist is updated for the Designated Employees. **[COUNSEL]** confirm whether this method
creates sufficient evidence of authority, or whether a signed PDF is needed.
