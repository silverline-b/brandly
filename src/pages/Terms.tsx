import { Link } from "react-router-dom";

const Terms = () => (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center">
        <Link to="/" className="text-xl font-bold text-foreground tracking-tight">Brandly</Link>
      </div>
    </header>

    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-foreground mb-2">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-8">Effective Date: January 1, 2026</p>

      <div className="prose prose-sm max-w-none space-y-6 text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1">
        <p>
          These Terms of Service ("Terms") govern your access to and use of the Brandly platform (the "Service") operated by Silverline Brands LLC ("Silverline Brands," "we," "us," or "our"). By creating an account or using the Service, you agree to be bound by these Terms.
        </p>

        <h2>1. Service Description</h2>
        <p>
          Brandly is an informational brand name research tool. The Service uses artificial intelligence to generate brand name suggestions and checks each name against publicly available trademark databases, domain registrars, and web search results. All results are informational and do not constitute legal advice.
        </p>

        <h2>2. Account Responsibilities</h2>
        <ul>
          <li>You must provide accurate and complete information when creating your account.</li>
          <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
          <li>You must be at least 18 years old to use the Service.</li>
          <li>You are responsible for all activity that occurs under your account.</li>
        </ul>

        <h2>3. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose or to facilitate illegal activity.</li>
          <li>Attempt to gain unauthorized access to the Service, other accounts, or our systems.</li>
          <li>Use automated scripts, bots, or scrapers to access the Service outside of the provided interface.</li>
          <li>Resell, redistribute, or sublicense access to the Service or its outputs without our written consent.</li>
          <li>Submit content that is defamatory, obscene, or infringes on third-party rights.</li>
        </ul>

        <h2>4. Payment and Credit Terms</h2>
        <ul>
          <li><strong>One-Time Purchase:</strong> Credits are purchased as a one-time payment. Brandly is not a subscription service.</li>
          <li><strong>Credit Expiration:</strong> Credits expire 12 months from the date of purchase.</li>
          <li><strong>No Refunds on Used Credits:</strong> Once credits have been consumed (i.e., a run has been initiated), they are non-refundable.</li>
          <li><strong>Partial Refunds:</strong> Refunds for unused credits may be considered if requested within 14 days of purchase. Contact <a href="mailto:support@support.com" className="text-primary hover:underline">support@support.com</a> to submit a request.</li>
        </ul>

        <h2>5. Intellectual Property</h2>
        <ul>
          <li><strong>User Ownership of Names:</strong> You own the brand names surfaced by the Service. Brandly does not claim any intellectual property rights over the names generated for you.</li>
          <li><strong>Platform Ownership:</strong> Silverline Brands LLC retains all rights, title, and interest in the Brandly platform, technology, algorithms, user interface, and documentation.</li>
          <li><strong>No Guarantee of Availability:</strong> The generation of a name by Brandly does not guarantee that the name is available for trademark registration, domain purchase, or commercial use.</li>
        </ul>

        <h2>6. Disclaimer of Warranties</h2>
        <p>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. BRANDLY'S TRADEMARK ANALYSIS, DOMAIN CHECKS, AND WEB PRESENCE SCANS ARE INFORMATIONAL ONLY. WE MAKE NO GUARANTEE OF TRADEMARK REGISTRATION SUCCESS, DOMAIN AVAILABILITY AT THE TIME OF PURCHASE, OR THE ABSENCE OF THIRD-PARTY CLAIMS. YOU SHOULD ALWAYS CONSULT A LICENSED TRADEMARK ATTORNEY BEFORE FILING ANY TRADEMARK APPLICATION.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, SILVERLINE BRANDS LLC'S TOTAL LIABILITY ARISING FROM OR RELATED TO THESE TERMS OR YOUR USE OF THE SERVICE SHALL NOT EXCEED THE TOTAL AMOUNT PAID BY YOU TO SILVERLINE BRANDS LLC IN THE THREE (3) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM. IN NO EVENT SHALL SILVERLINE BRANDS LLC BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.
        </p>

        <h2>8. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Silverline Brands LLC, its officers, directors, employees, and agents from any claims, damages, losses, or expenses (including reasonable attorneys' fees) arising from your use of the Service or your violation of these Terms.
        </p>

        <h2>9. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service at any time if you violate these Terms. Upon termination, your right to use the Service ceases immediately. Sections 5 through 8 survive termination.
        </p>

        <h2>10. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of Delaware, United States of America, without regard to its conflict of law provisions. Any disputes arising under these Terms shall be resolved exclusively in the state or federal courts located in the State of Delaware.
        </p>

        <h2>11. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. We will notify you of material changes by posting the updated Terms on this page with a revised effective date. Continued use of the Service after changes constitutes acceptance of the revised Terms.
        </p>

        <h2>12. Contact</h2>
        <p>
          For questions about these Terms, contact us at:<br />
          <a href="mailto:support@support.com" className="text-primary hover:underline">support@support.com</a>
        </p>
        <p className="text-xs text-muted-foreground mt-4">
          Silverline Brands LLC · United States of America
        </p>
      </div>
    </main>
  </div>
);

export default Terms;
