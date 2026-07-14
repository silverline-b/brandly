import { Link } from "react-router-dom";

const Privacy = () => (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center">
        <Link to="/" className="text-xl font-bold text-foreground tracking-tight">Brandly</Link>
      </div>
    </header>

    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Effective Date: January 1, 2026</p>

      <div className="prose prose-sm max-w-none space-y-6 text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-foreground [&_h3]:font-medium [&_h3]:mt-4 [&_h3]:mb-2 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
        <p>
          Silverline Brands LLC ("Silverline Brands," "we," "us," or "our") operates the Brandly platform (the "Service"). This Privacy Policy explains how we collect, use, disclose, and protect your information when you use our Service.
        </p>

        <h2>1. Information We Collect</h2>
        <h3>Account Information</h3>
        <p>When you create an account, we collect your name and email address.</p>
        <h3>Usage Data</h3>
        <p>We collect information about your use of the Service, including run parameters, generated name results, and interaction patterns.</p>
        <h3>Payment Data</h3>
        <p>Payments are processed by Stripe, Inc. We do not store your credit card details. We receive a transaction ID, purchase amount, and the package purchased from Stripe.</p>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li><strong>Service Delivery:</strong> To generate brand name suggestions, perform trademark and domain checks, and display results.</li>
          <li><strong>Product Improvement:</strong> To analyze aggregate usage patterns and improve the quality and performance of the Service.</li>
          <li><strong>Transactional Communications:</strong> To send you account confirmations, purchase receipts, and service-related notices.</li>
        </ul>

        <h2>3. Third-Party Services</h2>
        <p>We use the following third-party services to operate Brandly:</p>
        <ul>
          <li><strong>Supabase:</strong> Database hosting, user authentication, and serverless functions.</li>
          <li><strong>Stripe:</strong> Payment processing. Stripe's privacy policy governs how they handle your payment information.</li>
          <li><strong>OpenAI:</strong> AI-powered name generation. Run inputs (product description, keywords, audience, and style preferences) are sent to OpenAI's API. OpenAI's data usage policies apply to that processing.</li>
          <li><strong>Serper:</strong> Web search API used to check web presence of generated names.</li>
        </ul>

        <h2>4. Data Retention</h2>
        <ul>
          <li><strong>Account Data:</strong> Retained while your account is active.</li>
          <li><strong>Run Results:</strong> Retained for 24 months from the date of creation.</li>
          <li><strong>Deletion:</strong> Upon account deletion, all associated account data and run results are permanently deleted.</li>
        </ul>

        <h2>5. California Residents — CCPA Rights</h2>
        <p>If you are a California resident, you have the following rights under the California Consumer Privacy Act (CCPA):</p>
        <ul>
          <li><strong>Right to Know:</strong> You may request disclosure of the categories and specific pieces of personal information we have collected about you.</li>
          <li><strong>Right to Delete:</strong> You may request deletion of your personal information, subject to certain exceptions.</li>
          <li><strong>Right to Opt Out of Sale:</strong> We do not sell your personal information to third parties.</li>
        </ul>
        <p>To exercise these rights, contact us at <a href="mailto:support@support.com" className="text-primary hover:underline">support@support.com</a>.</p>

        <h2>6. Cookies</h2>
        <p>Brandly uses only essential cookies required for authentication and session management. We do not use advertising, analytics, or tracking cookies.</p>

        <h2>7. Data Security</h2>
        <p>We implement commercially reasonable technical and organizational measures to protect your data, including encryption in transit (TLS) and at rest. However, no method of transmission over the Internet or electronic storage is 100% secure.</p>

        <h2>8. Children's Privacy</h2>
        <p>The Service is not directed to children under 13. We do not knowingly collect personal information from children under 13.</p>

        <h2>9. Changes to This Policy</h2>
        <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page with a revised effective date.</p>

        <h2>10. Contact Us</h2>
        <p>
          For privacy-related inquiries or requests, contact us at:<br />
          <a href="mailto:support@support.com" className="text-primary hover:underline">support@support.com</a>
        </p>
        <p className="text-xs text-muted-foreground mt-4">
          Silverline Brands LLC · United States of America
        </p>
      </div>
    </main>
  </div>
);

export default Privacy;
