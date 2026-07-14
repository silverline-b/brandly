import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { PricingCards } from "@/components/PricingCards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  Search,
  Globe,
  ShieldCheck,
  BarChart3,
  Zap,
  ArrowRight,
  CheckCircle2,
  Send,
  Loader2,
} from "lucide-react";

const FEATURES = [
  {
    icon: Sparkles,
    title: "AI-Powered Name Generation",
    description: "GPT-4o generates creative, brandable names tailored to your product and audience.",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    icon: ShieldCheck,
    title: "USPTO Trademark Check",
    description: "Every name is screened against the USPTO database for potential conflicts.",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    icon: Globe,
    title: "Domain Availability",
    description: "Instantly check .com, .io, .app, and other TLD availability for each name.",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    icon: Search,
    title: "Web Presence Scan",
    description: "See if competitors are already using similar names across the web.",
    gradient: "from-orange-500 to-amber-500",
  },
  {
    icon: BarChart3,
    title: "Smart Scoring",
    description: "Each name gets a composite score based on trademark, domain, and web risk.",
    gradient: "from-rose-500 to-pink-500",
  },
  {
    icon: Zap,
    title: "Fast & Comprehensive",
    description: "Get 50+ vetted name suggestions in minutes, not days.",
    gradient: "from-violet-500 to-purple-500",
  },
];

const STEPS = [
  { step: "1", title: "Describe Your Product", description: "Tell us what you're building, your audience, and the vibe you want." },
  { step: "2", title: "AI Generates Names", description: "Our pipeline creates unique names and checks each one across multiple databases." },
  { step: "3", title: "Review Results", description: "Browse scored results with trademark, domain, and web risk data — all in one place." },
];

const Index = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [sending, setSending] = useState(false);

  const handleContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.name || !contactForm.email || !contactForm.subject || !contactForm.message) {
      toast({ title: "Please fill all fields", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.from("contact_messages").insert({
        name: contactForm.name,
        email: contactForm.email,
        subject: contactForm.subject,
        message: contactForm.message,
      });
      if (error) throw error;
      toast({ title: "Message sent!", description: "We'll get back to you soon." });
      setContactForm({ name: "", email: "", subject: "", message: "" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground tracking-tight">Brandly</span>
          </Link>
          <nav className="flex items-center gap-4">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline">
              Features
            </a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline">
              Pricing
            </a>
            <a href="#contact" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline">
              Contact
            </a>
            {user ? (
              <Button asChild size="sm" className="gradient-primary border-0 shadow-glow">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">Sign In</Link>
                </Button>
                <Button asChild size="sm" className="gradient-primary border-0 shadow-glow">
                  <Link to="/signup">Get Started</Link>
                </Button>
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 gradient-hero" />
        <div className="absolute top-20 left-1/4 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-10 right-1/4 h-64 w-64 rounded-full bg-pink-400/10 blur-3xl" />

        <div className="relative max-w-4xl mx-auto px-4 py-24 lg:py-36 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary font-medium mb-8">
            <Sparkles className="h-3.5 w-3.5" />
            AI-powered brand name research
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground tracking-tight leading-tight">
            Find the perfect brand name
            <span className="block bg-gradient-to-r from-primary to-pink-500 bg-clip-text text-transparent">
              — vetted in minutes
            </span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Brandly uses AI to generate creative names, then checks each one against
            trademark databases, domain registrars, and the web — so you can launch
            with confidence.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="text-base px-8 gradient-primary border-0 shadow-glow hover:opacity-90 transition-opacity">
              <Link to={user ? "/new-run" : "/signup"}>
                Start naming <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="text-base px-8">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
          {/* Trust indicators */}
          <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-primary" /> USPTO database checked</span>
            <span className="flex items-center gap-1.5"><Globe className="h-4 w-4 text-primary" /> 15 domain extensions</span>
            <span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" /> 50 names per run</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Everything you need to name your brand
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              One pipeline. Six checks. Zero guesswork.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Card key={f.title} className="group border-border/60 bg-card hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1">
                <CardContent className="pt-6">
                  <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${f.gradient} mb-4`}>
                    <f.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 bg-muted/50">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground">
              How it works
            </h2>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.step} className="text-center">
                <div className="w-14 h-14 rounded-2xl gradient-primary text-white flex items-center justify-center text-xl font-bold mx-auto mb-5 shadow-glow">
                  {s.step}
                </div>
                <h3 className="font-semibold text-foreground mb-2 text-lg">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Simple, pay-as-you-go pricing
            </h2>
            <p className="text-lg text-muted-foreground">
              No subscriptions. Buy credits, use them when you're ready.
            </p>
          </div>
          <PricingCards />
        </div>
      </section>

      {/* Why Brandly */}
      <section className="py-24 bg-muted/50">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground text-center mb-12">
            Why Brandly?
          </h2>
          <div className="space-y-4">
            {[
              "50+ AI-generated names per run — not just random combinations",
              "Real USPTO trademark screening, not a basic word match",
              "Domain checks across multiple TLDs in real time",
              "Web presence analysis to spot existing competitors",
              "Composite scoring so the best names rise to the top",
              "Credits never expire for 12 months — no subscription pressure",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <div className="mt-1 h-5 w-5 rounded-full gradient-primary flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-3 w-3 text-white" />
                </div>
                <p className="text-muted-foreground">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-24">
        <div className="max-w-xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-foreground text-center mb-4">
            Get in touch
          </h2>
          <p className="text-center text-muted-foreground mb-10">
            Questions, feedback, or partnership ideas? We'd love to hear from you.
          </p>
          <form onSubmit={handleContact} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                placeholder="Your name"
                value={contactForm.name}
                onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))}
              />
              <Input
                type="email"
                placeholder="Email address"
                value={contactForm.email}
                onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <Input
              placeholder="Subject"
              value={contactForm.subject}
              onChange={(e) => setContactForm((p) => ({ ...p, subject: e.target.value }))}
            />
            <Textarea
              placeholder="Your message..."
              rows={4}
              value={contactForm.message}
              onChange={(e) => setContactForm((p) => ({ ...p, message: e.target.value }))}
            />
            <Button type="submit" className="w-full gradient-primary border-0 shadow-glow hover:opacity-90 transition-opacity" disabled={sending}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Message
            </Button>
          </form>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="py-12 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Brandly is an informational tool. Our analysis is not legal advice and does not guarantee trademark registration. Always consult a licensed trademark attorney before filing any application.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Silverline Brands LLC. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <Link to="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/legal" className="hover:text-foreground transition-colors">Legal</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;