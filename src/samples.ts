export interface Sample {
  id: string;
  label: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'discharge',
    label: 'Hospital discharge note',
    text: `St. Agnes Regional Medical Center
Discharge Summary

Patient: Maria Elena Alvarez
DOB: 03/14/1958
MRN: 00483921-7
Attending Physician: Dr. Kenji Watanabe

Ms. Alvarez was admitted on 10/28 with acute decompensated heart failure (HFrEF, EF 30%) and community-acquired pneumonia. She was treated with IV furosemide and ceftriaxone, then transitioned to oral therapy.

Discharge medications:
- Furosemide 40 mg PO BID (new dose, previously 20 mg daily)
- Metoprolol succinate 25 mg daily
- Sacubitril/valsartan 24/26 mg BID (NEW)
- Amoxicillin-clavulanate 875 mg BID x 5 more days
- STOP lisinopril (do not take with sacubitril/valsartan; wait 36 hours)

Follow-up: BMP and weight check within 7 days. Cardiology clinic visit with Dr. Watanabe in 2 weeks.
Return to the ED for weight gain > 2 lb in a day or 5 lb in a week, shortness of breath at rest, or fainting.

Questions: call the Heart Failure Nurse Line at (617) 555-0142 or email hfnurse@stagnes-health.org.
Caregiver on file: Daniel Alvarez (son), 41 Maple Terrace, Apt 3B, Somerville.`,
  },
  {
    id: 'eviction',
    label: 'Notice from a landlord',
    text: `NOTICE TO PAY RENT OR QUIT

To: Tenant Jordan Okafor
Premises: 2217 Harmon Street, Apt 4C, Oakland, CA 94612
Lease ID: HR-2209-4C

From: Brightline Property Management LLC, on behalf of the owner

You are hereby notified that rent is past due for the premises above in the amount of $2,340.00 for the period of November 1 through November 30.

Within THREE (3) days after service of this notice, excluding Saturdays, Sundays and judicial holidays, you are required to pay the amount stated in full or deliver up possession of the premises. If you fail to do so, legal proceedings will be instituted against you to recover possession, declare the forfeiture of the lease, and recover rents and damages.

Payment may be made in person at 900 Broadway Suite 310, Oakland, Monday to Friday 9am to 5pm, or by cashier's check. Personal checks will not be accepted.

Contact: Priya Raman, Property Manager, (510) 555-0199, priya.raman@brightline-pm.com
Served by posting and mailing on November 6.`,
  },
  {
    id: 'insurance',
    label: 'Insurance claim denial',
    text: `Evergreen Mutual Health Plan
Explanation of Benefits / Notice of Adverse Benefit Determination

Member: Samuel T. Brooks
Member ID: EVM448210933
Group Number: 77120
Claim Number: CLM-2026-0918-55321
Provider: Northside Imaging Partners
Date of service: 09/18/2026

Service: MRI lumbar spine without contrast (CPT 72148)
Billed: $2,180.00   Allowed: $0.00   Plan paid: $0.00   You may owe: $2,180.00

Reason: Prior authorization was not obtained. Per your plan's utilization management policy, advanced imaging requires prior authorization unless performed in an emergency setting.

Your right to appeal: You or your authorized representative may request an internal appeal within 180 days of receiving this notice. Include a copy of this notice, any medical records supporting medical necessity, and a letter from your provider. You may also request an expedited appeal if waiting would seriously jeopardize your health.

Send appeals to: Appeals Unit, PO Box 30417, Salt Lake City, UT 84130, fax (801) 555-0177.
Questions: Member Services 1-800-555-0123. Card on file for premium autopay: 4111 1111 1111 1111.`,
  },
];
