# Evidence Artifact: Return Filing Authentication & ARN Issuance
File: docs/evidence/filing-otp-modal.md

## Observed Filing Flow
- Pre-filing check: Mandatory statutory declaration / authorization checkbox.
- Authentication modal: Prompt for 6-digit Electronic Verification Code (EVC) OTP sent to registered mobile/email.
- Submission result: GST Portal / GSP gateway verifies OTP and returns Acknowledgement Reference Number (ARN) with timestamp.
- Safety Boundary: Return filing operations in test environments must execute against simulated/sandbox endpoints.

