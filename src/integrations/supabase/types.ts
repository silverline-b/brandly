export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      analytics_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage_log: {
        Row: {
          api_calls: number | null
          created_at: string | null
          estimated_cost_usd: number | null
          id: string
          operation: string
          run_id: string | null
          service: string
          tokens_input: number | null
          tokens_output: number | null
          user_id: string | null
        }
        Insert: {
          api_calls?: number | null
          created_at?: string | null
          estimated_cost_usd?: number | null
          id?: string
          operation: string
          run_id?: string | null
          service: string
          tokens_input?: number | null
          tokens_output?: number | null
          user_id?: string | null
        }
        Update: {
          api_calls?: number | null
          created_at?: string | null
          estimated_cost_usd?: number | null
          id?: string
          operation?: string
          run_id?: string | null
          service?: string
          tokens_input?: number | null
          tokens_output?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_usage_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          created_at: string | null
          email: string
          id: string
          message: string
          name: string
          subject: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          message: string
          name: string
          subject: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          message?: string
          name?: string
          subject?: string
        }
        Relationships: []
      }
      daily_spend: {
        Row: {
          date: string
          domainr_usd: number | null
          openai_usd: number | null
          run_count: number | null
          serper_usd: number | null
          total_usd: number | null
        }
        Insert: {
          date: string
          domainr_usd?: number | null
          openai_usd?: number | null
          run_count?: number | null
          serper_usd?: number | null
          total_usd?: number | null
        }
        Update: {
          date?: string
          domainr_usd?: number | null
          openai_usd?: number | null
          run_count?: number | null
          serper_usd?: number | null
          total_usd?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_runs: number | null
          created_at: string | null
          email: string
          full_name: string | null
          id: string
        }
        Insert: {
          active_runs?: number | null
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
        }
        Update: {
          active_runs?: number | null
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          credits_total: number
          credits_used: number | null
          expires_at: string | null
          id: string
          package_id: string
          purchased_at: string | null
          stripe_payment_intent_id: string | null
          user_id: string | null
        }
        Insert: {
          credits_total: number
          credits_used?: number | null
          expires_at?: string | null
          id?: string
          package_id: string
          purchased_at?: string | null
          stripe_payment_intent_id?: string | null
          user_id?: string | null
        }
        Update: {
          credits_total?: number
          credits_used?: number | null
          expires_at?: string | null
          id?: string
          package_id?: string
          purchased_at?: string | null
          stripe_payment_intent_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      run_candidates: {
        Row: {
          created_at: string | null
          data: Json
          id: string
          run_id: string
          stage: string
        }
        Insert: {
          created_at?: string | null
          data: Json
          id?: string
          run_id: string
          stage: string
        }
        Update: {
          created_at?: string | null
          data?: Json
          id?: string
          run_id?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_candidates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      run_results: {
        Row: {
          best_domain: string | null
          best_domain_is_exact: boolean | null
          brand_clarity: string | null
          clarity_notes: string | null
          composite_score: number | null
          confusion_risk: string | null
          created_at: string | null
          domain_results: Json | null
          id: string
          name: string
          presence_summary: string | null
          run_id: string | null
          uspto_conflicting_marks: Json | null
          uspto_reasoning: string | null
          uspto_stars: number | null
          uspto_status: string | null
          web_risk_level: string | null
          web_risk_notes: string | null
          web_snippet: string | null
          web_summary: string | null
        }
        Insert: {
          best_domain?: string | null
          best_domain_is_exact?: boolean | null
          brand_clarity?: string | null
          clarity_notes?: string | null
          composite_score?: number | null
          confusion_risk?: string | null
          created_at?: string | null
          domain_results?: Json | null
          id?: string
          name: string
          presence_summary?: string | null
          run_id?: string | null
          uspto_conflicting_marks?: Json | null
          uspto_reasoning?: string | null
          uspto_stars?: number | null
          uspto_status?: string | null
          web_risk_level?: string | null
          web_risk_notes?: string | null
          web_snippet?: string | null
          web_summary?: string | null
        }
        Update: {
          best_domain?: string | null
          best_domain_is_exact?: boolean | null
          brand_clarity?: string | null
          clarity_notes?: string | null
          composite_score?: number | null
          confusion_risk?: string | null
          created_at?: string | null
          domain_results?: Json | null
          id?: string
          name?: string
          presence_summary?: string | null
          run_id?: string | null
          uspto_conflicting_marks?: Json | null
          uspto_reasoning?: string | null
          uspto_stars?: number | null
          uspto_status?: string | null
          web_risk_level?: string | null
          web_risk_notes?: string | null
          web_snippet?: string | null
          web_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          batches_run: number | null
          candidate_target: number | null
          completed_at: string | null
          created_at: string | null
          credits_used_for_run: number | null
          current_step: string | null
          filter_allow_prefix_suffix: boolean | null
          filter_min_stars: number | null
          filter_tlds: string[] | null
          id: string
          keywords: string[] | null
          name_length: string | null
          name_style: string | null
          nice_classes: number[] | null
          product_description: string
          purchase_id: string | null
          results_count: number | null
          status: string | null
          style_buckets: Json | null
          target_audience: string | null
          user_id: string | null
          vibe: string[] | null
        }
        Insert: {
          batches_run?: number | null
          candidate_target?: number | null
          completed_at?: string | null
          created_at?: string | null
          credits_used_for_run?: number | null
          current_step?: string | null
          filter_allow_prefix_suffix?: boolean | null
          filter_min_stars?: number | null
          filter_tlds?: string[] | null
          id?: string
          keywords?: string[] | null
          name_length?: string | null
          name_style?: string | null
          nice_classes?: number[] | null
          product_description: string
          purchase_id?: string | null
          results_count?: number | null
          status?: string | null
          style_buckets?: Json | null
          target_audience?: string | null
          user_id?: string | null
          vibe?: string[] | null
        }
        Update: {
          batches_run?: number | null
          candidate_target?: number | null
          completed_at?: string | null
          created_at?: string | null
          credits_used_for_run?: number | null
          current_step?: string | null
          filter_allow_prefix_suffix?: boolean | null
          filter_min_stars?: number | null
          filter_tlds?: string[] | null
          id?: string
          keywords?: string[] | null
          name_length?: string | null
          name_style?: string | null
          nice_classes?: number[] | null
          product_description?: string
          purchase_id?: string | null
          results_count?: number | null
          status?: string | null
          style_buckets?: Json | null
          target_audience?: string | null
          user_id?: string | null
          vibe?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "runs_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: { check_user_id?: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
