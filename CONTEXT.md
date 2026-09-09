# JobPilot

JobPilot supports a person's job applications with reviewed form filling, tailored documents and application memory.

## Language

**Profile**: A named collection of the applicant's facts, experience, preferences and document choices. Multiple profiles can belong to the same person.
_Avoid_: Account, applicant identity

**Posting**: An employer's description of a particular open role, including its source location. A posting is distinct from an application to that role.
_Avoid_: Application, submission

**Application**: The applicant's work toward applying to one posting, including selected profile, documents and answers. An application can exist before it is submitted.
_Avoid_: Company, page, browser tab

**Fill plan**: Proposed values for the discovered form fields, together with the person's decisions about which values to include. A plan is a reviewable proposal, not proof of a successful fill.
_Avoid_: Completed form

**Fill run**: One attempt to apply the reviewed fill plan to its originating form. A fill run has outcomes for the fields it attempts.
_Avoid_: Submission

**Submit attempt**: The applicant activates a control intended to submit an application. The attempt alone is not evidence that the employer received it.
_Avoid_: Confirmed application

**Confirmation evidence**: A page or message that supports the conclusion that an employer received a specific application. Ambiguous page text is not conclusive evidence.
_Avoid_: Submit click

**Document**: A stored file available for use in an application, such as an uploaded resume or a generated PDF.
_Avoid_: Profile

**Document version**: A reviewed tailored resume or cover letter associated with its content and generated file formats. Its PDF and DOCX are formats of that version, not separate applications.
_Avoid_: Application version

**Captured answer**: Text retained from the applicant's form at a submit attempt. Capture says where the text came from, not whether it is suitable for another employer.
_Avoid_: Reusable answer

**Application-only answer**: An answer available as a suggestion for its originating application. Reusing it for another application requires a separate choice.
_Avoid_: Reusable answer, private answer

**Reusable answer**: An answer explicitly allowed to appear as a suggestion for other applications. Reusability is separate from whether text was typed or generated.
_Avoid_: Automatically safe answer

**Tracker record**: The saved status and history of an application. It is distinct from the employer's underlying submission record.
_Avoid_: Receipt
