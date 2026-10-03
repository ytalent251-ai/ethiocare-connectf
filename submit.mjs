import { Resend } from 'resend';

const RECIPIENT = 'ethiocareconnect@gmail.com';
const MAX_CV_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx']);
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

const text = (form, name, limit = 8000) => form.getAll(name)
  .map(value => typeof value === 'string' ? value : '')
  .map(value => value.replace(/[\r\n]+/g, ' ').trim().slice(0, limit))
  .filter(Boolean)
  .join(', ');

const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function lines(form, fields) {
  return fields.map(([label, name]) => `${label}: ${text(form, name) || 'Not provided'}`);
}

function validate(form, formType) {
  const required = formType === 'organization'
    ? ['Organization / Facility Name', 'Contact Person', 'Work Email', 'Country', 'Organization Type', 'Languages Needed', 'Interpretation Type', 'Message / Requirements', 'Required privacy consent']
    : formType === 'interpreter'
      ? ['Full Name', 'Email', 'Phone / WhatsApp', 'Country', 'City', 'Primary Language', 'Language Direction', 'Medical Interpretation Experience', 'Required privacy consent']
      : ['name', 'email', 'message'];
  if (required.some(name => !text(form, name))) return false;
  return validEmail(text(form, formType === 'organization' ? 'Work Email' : formType === 'interpreter' ? 'Email' : 'email'));
}

function message(form, formType) {
  if (formType === 'contact') {
    return [
      'Form: General Contact Inquiry',
      `Submitted (UTC): ${new Date().toISOString()}`,
      '',
      ...lines(form, [['Name', 'name'], ['Email', 'email'], ['Organization', 'organization'], ['Contact type', 'type'], ['Reason for reaching out', 'need'], ['Message', 'message']])
    ].join('\n');
  }
  const organization = [
    ['Organization / Facility Name', 'Organization / Facility Name'], ['Contact Person', 'Contact Person'], ['Work Email', 'Work Email'], ['Phone / WhatsApp', 'Phone / WhatsApp'], ['Country', 'Country'], ['City', 'City'], ['Organization Type', 'Organization Type'], ['Languages Needed', 'Languages Needed'], ['Interpretation Type', 'Interpretation Type'], ['Expected Frequency / Volume', 'Expected Frequency / Volume'], ['Message / Requirements', 'Message / Requirements']
  ];
  const interpreter = [
    ['Full Name', 'Full Name'], ['Email', 'Email'], ['Phone / WhatsApp', 'Phone / WhatsApp'], ['Country', 'Country'], ['City', 'City'], ['Primary Language', 'Primary Language'], ['Other Languages', 'Other Languages'], ['Language Direction', 'Language Direction'], ['Medical Interpretation Experience', 'Medical Interpretation Experience'], ['Medical / Healthcare Background', 'Medical / Healthcare Background'], ['Medical Interpretation Training / Certification', 'Medical Interpretation Training / Certification'], ['Other Relevant Certifications', 'Other Relevant Certifications'], ['LinkedIn Profile', 'LinkedIn Profile'], ['Preferred Interpretation Type', 'Preferred Interpretation Type'], ['Availability', 'Availability'], ['Additional Information / Message', 'Additional Information / Message']
  ];
  return [
    `Form: ${formType === 'organization' ? 'Healthcare Organization Inquiry' : 'Medical Interpreter Registration'}`,
    `Submitted (UTC): ${new Date().toISOString()}`,
    '', ...lines(form, formType === 'organization' ? organization : interpreter), '',
    `Required privacy consent: ${text(form, 'Required privacy consent') ? 'Confirmed' : 'Not confirmed'}`,
    `Optional communications consent: ${text(form, 'Optional communication consent') ? 'Yes' : 'No'}`
  ].join('\n');
}

async function attachment(form) {
  const file = form.get('CV / Resume');
  if (!file || typeof file === 'string' || !file.name) return [];
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension) || file.size > MAX_CV_BYTES || (file.type && !ALLOWED_TYPES.has(file.type))) {
    throw new Error('INVALID_FILE');
  }
  return [{ filename: file.name, content: Buffer.from(await file.arrayBuffer()) }];
}

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) return json({ error: 'Submission service is not configured' }, 503);
  try {
    const form = await request.formData();
    if (text(form, 'website')) return json({ ok: true });
    const formType = text(form, 'formType');
    if (!['contact', 'organization', 'interpreter'].includes(formType) || !validate(form, formType)) return json({ error: 'Please complete all required fields.' }, 400);
    const replyTo = text(form, formType === 'organization' ? 'Work Email' : formType === 'interpreter' ? 'Email' : 'email');
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.FROM_EMAIL,
      to: [RECIPIENT],
      replyTo,
      subject: formType === 'organization' ? 'New Healthcare Organization Inquiry – EthioCare Connect' : formType === 'interpreter' ? 'New Medical Interpreter Registration – EthioCare Connect' : 'New EthioCare Connect Contact Inquiry',
      text: message(form, formType),
      attachments: await attachment(form)
    });
    if (result.error) throw new Error('EMAIL_REJECTED');
    return json({ ok: true });
  } catch (error) {
    if (error.message === 'INVALID_FILE') return json({ error: 'Please upload a PDF, DOC, or DOCX file smaller than 5 MB.' }, 400);
    return json({ error: 'Unable to process submission.' }, 500);
  }
};
