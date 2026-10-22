import { useMemo, useState } from 'react';
import type { EventPlan, Vendor, VendorCategory } from '../domain/types';
import { newId } from '../domain/events';
import { money } from '../ui/format';
import { formatDate, titleCase } from '../ui/format';
import { EmptyState, Field } from '../ui/atoms';

const VENDOR_CATEGORIES: VendorCategory[] = [
  'venue',
  'catering',
  'photography',
  'decoration',
  'entertainment',
  'transportation',
  'accommodation',
  'other',
];

const STATUSES: Vendor['bookingStatus'][] = [
  'not-contacted',
  'shortlist',
  'contacted',
  'quoted',
  'booked',
  'declined',
];

const PAYMENTS: Vendor['paymentStatus'][] = ['none', 'advance-paid', 'partial', 'paid'];

export function VendorsView({
  plan,
  onVendors,
}: {
  plan: EventPlan;
  onVendors: (vendors: Vendor[]) => void;
}) {
  const currency = plan.input.budget.currency;
  const [form, setForm] = useState({
    name: '',
    category: 'venue' as VendorCategory,
    contact: '',
    quoted: '',
    bookingStatus: 'not-contacted' as Vendor['bookingStatus'],
    paymentStatus: 'none' as Vendor['paymentStatus'],
    notes: '',
    followUpDate: '',
  });

  const requirementByCategory = useMemo(() => {
    const map = new Map<VendorCategory, EventPlan['vendorRequirements'][number]>();
    for (const r of plan.vendorRequirements) map.set(r.category, r);
    return map;
  }, [plan.vendorRequirements]);

  const addVendor = () => {
    if (!form.name.trim()) return;
    const vendor: Vendor = {
      id: newId('vnd'),
      name: form.name.trim(),
      category: form.category,
      contact: form.contact.trim(),
      bookingStatus: form.bookingStatus,
      paymentStatus: form.paymentStatus,
      notes: form.notes.trim(),
      source: 'user',
    };
    if (form.quoted.trim()) {
      const minor = Math.round(Number(form.quoted.replace(/[^0-9.]/g, '')) * 100);
      if (Number.isFinite(minor) && minor > 0) vendor.quotedPriceMinor = minor;
    }
    if (form.followUpDate) vendor.followUpDate = form.followUpDate;
    onVendors([...plan.vendors, vendor]);
    setForm((f) => ({ ...f, name: '', contact: '', quoted: '', notes: '', followUpDate: '' }));
  };

  const updateVendor = (id: string, patch: Partial<Vendor>) => {
    onVendors(plan.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  };

  const removeVendor = (id: string) => onVendors(plan.vendors.filter((v) => v.id !== id));

  const requirementProgress = plan.vendorRequirements.filter((r) => r.booked).length;

  return (
    <div className="vendors-view">
      <section className="panel">
        <h3>
          What to source · {requirementProgress}/{plan.vendorRequirements.length} booked
        </h3>
        <p className="muted">
          These are the things your plan says you will need. The guide figure is a planning estimate based on the budget you
          set aside, not a quotation, and we do not invent specific vendors.
        </p>
        <div className="requirement-cards">
          {plan.vendorRequirements.map((r) => (
            <article key={r.id} className={`req-card ${r.booked ? 'booked' : ''}`}>
              <header>
                <span className="req-cat">{titleCase(r.category)}</span>
                <span className={`pill ${r.bookingPriority}`}>{titleCase(r.bookingPriority)}</span>
              </header>
              <p className="req-guide">Guide: {money(r.budgetGuideMinor, currency)}</p>
              <div className="req-block">
                <span className="req-block-label">Services</span>
                <ul>
                  {r.services.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div className="req-block">
                <span className="req-block-label">Questions to ask</span>
                <ul>
                  {r.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
              <div className="req-block">
                <span className="req-block-label">Compare on</span>
                <ul className="inline">
                  {r.comparisonCriteria.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
              {r.booked ? <span className="tag">booked</span> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>Your vendor list</h3>
        {plan.vendors.length === 0 ? (
          <EmptyState
            title="No vendors recorded yet"
            body="Add venues, caterers and others you have contacted, their quotes and where each conversation stands."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Contact</th>
                  <th>Quote</th>
                  <th>Booking</th>
                  <th>Payment</th>
                  <th>Follow-up</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.vendors.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <input className="inline-input" value={v.name} onChange={(e) => updateVendor(v.id, { name: e.target.value })} />
                    </td>
                    <td>
                      <select
                        className="inline-input"
                        value={v.category}
                        onChange={(e) => updateVendor(v.id, { category: e.target.value as VendorCategory })}
                      >
                        {VENDOR_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {titleCase(c)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        value={v.contact}
                        onChange={(e) => updateVendor(v.id, { contact: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input small"
                        defaultValue={v.quotedPriceMinor ? (v.quotedPriceMinor / 100).toString() : ''}
                        onBlur={(e) => {
                          const parsed = Math.round(Number(e.target.value.replace(/[^0-9.]/g, '')) * 100);
                          updateVendor(v.id, { quotedPriceMinor: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined });
                        }}
                      />
                    </td>
                    <td>
                      <select
                        className="inline-input"
                        value={v.bookingStatus}
                        onChange={(e) => updateVendor(v.id, { bookingStatus: e.target.value as Vendor['bookingStatus'] })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {titleCase(s)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="inline-input"
                        value={v.paymentStatus}
                        onChange={(e) => updateVendor(v.id, { paymentStatus: e.target.value as Vendor['paymentStatus'] })}
                      >
                        {PAYMENTS.map((s) => (
                          <option key={s} value={s}>
                            {titleCase(s)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{v.followUpDate ? formatDate(v.followUpDate) : '—'}</td>
                    <td>
                      <button type="button" className="icon-btn danger" onClick={() => removeVendor(v.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h3>Add a vendor</h3>
        <div className="form-grid">
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Category">
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as VendorCategory }))}
            >
              {VENDOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contact" hint="Phone, email or handle.">
            <input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} />
          </Field>
          <Field label={`Quote (${currency})`}>
            <input value={form.quoted} inputMode="numeric" onChange={(e) => setForm((f) => ({ ...f, quoted: e.target.value }))} />
          </Field>
          <Field label="Booking status">
            <select
              value={form.bookingStatus}
              onChange={(e) => setForm((f) => ({ ...f, bookingStatus: e.target.value as Vendor['bookingStatus'] }))}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment status">
            <select
              value={form.paymentStatus}
              onChange={(e) => setForm((f) => ({ ...f, paymentStatus: e.target.value as Vendor['paymentStatus'] }))}
            >
              {PAYMENTS.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Follow-up date">
            <input
              type="date"
              value={form.followUpDate}
              onChange={(e) => setForm((f) => ({ ...f, followUpDate: e.target.value }))}
            />
          </Field>
          <Field label="Notes">
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
        <div className="wizard-actions">
          <button type="button" className="primary" onClick={addVendor} disabled={!form.name.trim()}>
            Add vendor
          </button>
        </div>
        {requirementByCategory.size > 0 ? (
          <p className="muted">
            Tip: check a requirement card's guide figure against quotes you collect, then record the real quote here.
          </p>
        ) : null}
      </section>
    </div>
  );
}
