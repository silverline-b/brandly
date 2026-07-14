import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const Legal = () => (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center">
        <Link to="/" className="text-xl font-bold text-foreground tracking-tight">Brandly</Link>
      </div>
    </header>

    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-foreground mb-8">Legal Notices</h1>

      {/* Trademark Disclaimer */}
      <section className="mb-12">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
              <h2 className="text-xl font-semibold text-foreground">Trademark Disclaimer</h2>
            </div>
            <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <p>
                <strong className="text-foreground">Brandly's trademark analysis is informational only and does not constitute legal advice.</strong>
              </p>
              <p>
                The Service searches publicly available data from the United States Patent and Trademark Office (USPTO) to identify potential trademark conflicts. However, this automated search cannot replicate the thoroughness of a full legal trademark examination conducted by a qualified professional.
              </p>
              <p>
                Specifically, Brandly's analysis:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>May not identify all existing trademarks, including state-level registrations, common law marks, or pending applications not yet indexed.</li>
                <li>Does not evaluate the full scope of likelihood of confusion factors considered by the USPTO examining attorneys.</li>
                <li>Does not account for design marks, trade dress, or other non-textual intellectual property.</li>
                <li>Cannot predict the outcome of any trademark application or opposition proceeding.</li>
              </ul>
              <p className="font-medium text-foreground">
                You must consult a licensed, USPTO-registered trademark attorney before filing any trademark application. Silverline Brands LLC assumes no liability for decisions made based on Brandly's informational reports.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Third-Party Attributions */}
      <section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Third-Party Attributions</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Brandly relies on the following third-party services and data sources:
        </p>
        <div className="space-y-4">
          {[
            {
              name: "United States Patent and Trademark Office (USPTO)",
              description: "Public trademark data used under open government data access policies. Brandly is not affiliated with, endorsed by, or sponsored by the USPTO.",
            },
            {
              name: "OpenAI",
              description: "AI generation services used to create brand name suggestions based on user-provided inputs.",
            },
            {
              name: "Serper",
              description: "Web search API used to assess existing web presence for generated brand names.",
            },
            {
              name: "Stripe",
              description: "Payment processing services. All payment data is handled directly by Stripe in accordance with PCI-DSS standards.",
            },
            {
              name: "Domainr",
              description: "Domain name availability data used to check TLD availability for generated names.",
            },
            {
              name: "Supabase",
              description: "Cloud infrastructure providing database hosting, user authentication, and serverless function execution.",
            },
          ].map((service) => (
            <div key={service.name} className="border-b border-border pb-4 last:border-0">
              <h3 className="text-sm font-medium text-foreground">{service.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-12 pt-6 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Silverline Brands LLC · United States of America · For questions, contact <a href="mailto:support@support.com" className="text-primary hover:underline">support@support.com</a>
        </p>
      </div>
    </main>
  </div>
);

export default Legal;
