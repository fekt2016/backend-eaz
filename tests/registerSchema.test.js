// T17: registerSchema now allows email OR phone. Unit tests for the schema in
// isolation (no DB) — specifically covering the empty-string trap: a blank form
// field posts as '', not undefined, and z.string().email() runs format validation
// on a defined '' before .refine()'s "provide one or the other" message ever fires.
const { registerSchema } = require("../validation/authSchema");

const base = { name: "Ama", password: "Password123!" };

describe("registerSchema — email OR phone", () => {
  it("accepts email only", () => {
    const result = registerSchema.safeParse({ ...base, email: "ama@t.com" });
    expect(result.success).toBe(true);
  });

  it("accepts phone only (no email key at all)", () => {
    const result = registerSchema.safeParse({ ...base, phone: "0201234567" });
    expect(result.success).toBe(true);
  });

  it("rejects both missing", () => {
    const result = registerSchema.safeParse({ ...base });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe("Provide an email or phone number.");
  });

  it("rejects both present but empty strings — not just undefined", () => {
    const result = registerSchema.safeParse({ ...base, email: "", phone: "" });
    expect(result.success).toBe(false);
    // Must be the refine's friendly message, NOT z.string().email()'s "Invalid email"
    // firing on the empty string before refine gets a turn.
    expect(result.error.issues[0].message).toBe("Provide an email or phone number.");
  });

  it("treats a whitespace-only email as blank and still passes on phone alone", () => {
    const result = registerSchema.safeParse({ ...base, email: "   ", phone: "0201234567" });
    expect(result.success).toBe(true);
    expect(result.data.email).toBeUndefined();
    expect(result.data.phone).toBe("0201234567");
  });

  it("still enforces email format when an actual (non-blank) value is given", () => {
    const result = registerSchema.safeParse({ ...base, email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe("Invalid email");
  });

  it("a blank phone with a valid email still passes (phone stays optional)", () => {
    const result = registerSchema.safeParse({ ...base, email: "ama@t.com", phone: "" });
    expect(result.success).toBe(true);
    expect(result.data.phone).toBeUndefined();
  });
});
