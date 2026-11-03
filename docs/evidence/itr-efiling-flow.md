# ITR E-Filing Evidence & Behavioral Specification

Backing evidence captured from user-supplied UI captures in `photo/` (`Screenshot 2026-11-03 093413.png` through `093801.png`).

---

## 1. Observed Flows & Screens

1. **Top Navigation & Filing Entity**:
   - Header with brand title, center filing entity dropdown `Filing for: CVBBC4433W`, chat support button, and user profile avatar with dropdown menu (`photo/Screenshot 2026-11-03 093801.png`).
   - Profile menu options: My Tax Returns, Profile, My Orders, My Rewards, Advanced Options, Prepare Rectification JSON U/S 139(9), Import Prefill JSON, Check ITR Status, Tax filing from experts, Need Help?, Logout.

2. **4-Step Stepper**:
   - Step 1: `Personal Info` (with warning/error icon badge `!`).
   - Step 2: `Income Sources` (with warning badge `!`).
   - Step 3: `Tax Saving` (with checkmark badge `✓`).
   - Step 4: `Tax Summary` (dark navy pill when active).

3. **Step 1: Personal Info**:
   - Banner: `There are errors in this section, please fix them.`
   - Card 1: `Permanent Information` (`Details Added` badge):
     - Name * (First Name, Middle Name, Last Name) with hint: *"Name should be as per the PAN; 5th character of PAN no. is the first letter of the last name"*.
     - Date of Birth * (`07/10/2006`) with hint: *"Specify date in a format like DD/MM/YYYY"*.
     - Father's Name *.
   - Card 2: `Identification & Contact details` (`Details Missing` badge):
     - Aadhaar Details * (`Enter 12 digit number`, helper link `Search it here`).
     - PAN * (`CVBBC4433W`).
     - Mobile No * (`+91`, input with warning outline and error `Please fill this field.`).
     - Email * (`sanjayharshi2005@gmail.com`).
     - Link: `Add Additional Information (Optional) ⌵`.
   - Cards 3-6: `Your Address`, `Residential Status`, `Bank Details`, and `Pre-fill Income details from Income Tax Dept` (`Fetch Income Details`).
   - Bottom CTA: `Go to next ->`.

4. **Step 2: Income Sources**:
   - Green banner: `File your taxes confidently with 100% accuracy — We've got you covered. Learn More >`.
   - Warning box when income is zero: `The total income in this tax return is zero. Please check if you have entered your salary / interest income correctly.`.
   - 8 Income category cards:
     1. `Salary Income` (`Add Manually`, `Upload Form 16`).
     2. `Interest Income` (`Add Details`).
     3. `Investments - Indian & US Stocks, Mutual Funds, FnO, Others` (`Add Details`).
     4. `ESOPs, RSUs, ESSPs` (`Add Details`).
     5. `House Properties owned by you` (`Add Details`).
     6. `Dividend Income` (`Add Details`).
     7. `Professional, Freelancing and Business Income` (`Add Details`).
     8. `Crypto Income (Virtual Digital Assets - VDA)` (`Add Details`).

5. **Step 3: Tax Saving**:
   - Banner: `Auto-fill all the below details by importing 'Form 26AS' and 'AIS' from Income Tax Department. [Import from ITD]`.
   - Cards: `Tax Savings Deductions`, `Taxes Paid, TDS and TCS`, `Carry Forward Losses, AIS & Foreign Assets(Schedule FA & FSI)`.

6. **Step 4: Tax Summary**:
   - Top banner: `View a personalised explanation of how your tax has been computed. [View Report]`.
   - Warning banner: `Few details are missing. Add them to generate your complete tax summary. [Fix Errors]`.
   - Status cards: `Your ITR Type: ITR 1`, `Your Tax Regime: New Regime` (`Compare/Switch Regime >`).
   - Hero card: `Awesome, Let's prepare your tax summary` (Gross Income, Your Tax Savings, Taxable Income, Total Tax, Tax Already Paid, Tax Refund).
   - Detailed calculation review: Total Tax, Tax Already Paid, Refund Available.
   - Post-checkout / download report access.
   - Bottom link: `(?) Have any doubts regarding tax calculation? Ask here >`.

7. **Sidebar (Across all steps)**:
   - `Customer Support >` "AI and Human Assistance".
   - `Expert Filing` card (coupon `Flat 65% OFF Code: TAXHERO65`, countdown `09:54 mins`, `Hire an Expert`).
   - `Live Filing` card (red badge, `Book your live filing call`).

