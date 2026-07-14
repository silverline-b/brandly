import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, CheckCircle2, Mail } from "lucide-react";
import { z } from "zod";

const SUBJECTS = [
  "General Inquiry",
  "Billing Question",
  "Technical Support",
  "Feature Request",
  "Other",
] as const;

const contactSchema = z.object({
  name: z.string().trim().min(1, "Full name is required").max(100, "Name must be under 100 characters"),
  email: z.string().trim().email("Please enter a valid email address").max(255),
  subject: z.string().min(1, "Please select a subject"),
  message: z.string().trim().min(20, "Message must be at least 20 characters").max(2000, "Message must be under 2000 characters"),
});

const Contact = () => {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = contactSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const key = issue.path[0] as string;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setSending(true);
    try {
      const { error } = await supabase.from("contact_messages").insert({
        name: result.data.name,
        email: result.data.email,
        subject: result.data.subject,
        message: result.data.message,
      });
      if (error) throw error;
      setSent(true);
    } catch {
      toast({
        title: "Something went wrong",
        description: (
          <span>
            Please email us directly at{" "}
            <a href="mailto:support@support.com" className="underline">support@support.com</a>
          </span>
        ),
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const charCount = form.message.length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center">
          <Link to="/" className="text-xl font-bold text-foreground tracking-tight">Brandly</Link>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold text-foreground text-center mb-2">Get in Touch</h1>
        <p className="text-center text-muted-foreground mb-10">
          We typically respond within 1 business day.
        </p>

        {sent ? (
          <div className="text-center py-12">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Your message has been sent.</h2>
            <p className="text-muted-foreground">
              We'll be in touch at <span className="font-medium text-foreground">{form.email}</span> within 1 business day.
            </p>
            <Button variant="outline" className="mt-6" onClick={() => { setSent(false); setForm({ name: "", email: "", subject: "", message: "" }); }}>
              Send another message
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                placeholder="Your full name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className={errors.name ? "border-destructive" : ""}
              />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>

            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                className={errors.email ? "border-destructive" : ""}
              />
              {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
            </div>

            <div>
              <Label htmlFor="subject">Subject</Label>
              <Select value={form.subject} onValueChange={(v) => setForm((p) => ({ ...p, subject: v }))}>
                <SelectTrigger className={errors.subject ? "border-destructive" : ""}>
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECTS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.subject && <p className="text-xs text-destructive mt-1">{errors.subject}</p>}
            </div>

            <div>
              <div className="flex justify-between items-end mb-1.5">
                <Label htmlFor="message">Message</Label>
                <span className={`text-xs ${charCount < 20 ? "text-muted-foreground" : "text-primary"}`}>
                  {charCount} / 2000
                </span>
              </div>
              <Textarea
                id="message"
                placeholder="How can we help you?"
                rows={5}
                maxLength={2000}
                value={form.message}
                onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                className={errors.message ? "border-destructive" : ""}
              />
              {errors.message && <p className="text-xs text-destructive mt-1">{errors.message}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={sending}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Message
            </Button>
          </form>
        )}

        <div className="mt-10 pt-6 border-t border-border space-y-3 text-center">
          <p className="text-sm text-muted-foreground">
            <Mail className="inline h-4 w-4 mr-1 -mt-0.5" />
            Or email us directly:{" "}
            <a href="mailto:support@support.com" className="text-primary hover:underline font-medium">
              support@support.com
            </a>
          </p>
          <p className="text-xs text-muted-foreground">
            For trademark legal questions, please consult a licensed attorney. Brandly cannot provide legal advice.
          </p>
        </div>
      </main>
    </div>
  );
};

export default Contact;
