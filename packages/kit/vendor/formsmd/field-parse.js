/*
 * The form-field grammar of forms.md, as a pure function — the field-line pattern and the parameter
 * parsing factored out of the original `form-field-create.js` (formFieldSetup, createTextField,
 * createNumberField, createSelectField, createChoiceField, createRatingField, createOpinionScaleField,
 * createDatetimeField, createFileField), with the HTML rendering left behind. What the original
 * accepted, this accepts, and what it discarded with a console warning is discarded here and returned
 * as a warning instead, so the caller decides what to do with it. The "question" keeps its plain words
 * (the original wrapped the last word in a required marker's markup).
 *
 *   parseFieldLine('name* = ChoiceInput(| question = Pick one | choices = A, B)', '|')
 *   → { name, type: 'choiceInput', kind: 'choice', required: true, params: { question, choices: [{ value, label, image }] }, warnings: [] }
 *
 * A line that is not a field returns null.
 */
import { isNumeric, unescape } from './helpers.js';
import { getPhoneNumberPlaceholder } from './phone-numbers.js';

/* forms.md's type names (as its docs write them) and the kit's short kinds */
const TYPES = {
	textinput: ["textInput", "text"],
	emailinput: ["emailInput", "email"],
	urlinput: ["urlInput", "url"],
	telinput: ["telInput", "tel"],
	passwordinput: ["passwordInput", "password"],
	numberinput: ["numberInput", "number"],
	selectbox: ["selectBox", "select"],
	choiceinput: ["choiceInput", "choice"],
	picturechoice: ["pictureChoice", "picture"],
	ratinginput: ["ratingInput", "rating"],
	opinionscale: ["opinionScale", "scale"],
	datetimeinput: ["datetimeInput", "datetime"],
	dateinput: ["dateInput", "date"],
	timeinput: ["timeInput", "time"],
	fileinput: ["fileInput", "file"],
	/* the kit's two: an answer somebody SAYS rather than types. A voice note is the chat's own MP3
	   recorder and a video is MediaRecorder; either way what comes out is a file, and it goes to the
	   forms bucket like any other file answer — so nothing downstream of the field knows the
	   difference. */
	voiceinput: ["voiceInput", "voice"],
	videoinput: ["videoInput", "video"],
};

/* THE FIELD LINE, built from the kinds above so the list is written once. It was written out twice
   — here and again in the kit's own parse.js — and a kind added to one and not the other is a field
   the language accepts and the reader never draws. */
export const TYPE_NAMES = Object.keys(TYPES);
const formFieldPattern = new RegExp(
	"\\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*(\\*)?\\s*=\\s*(" + TYPE_NAMES.join("|") + ")\\((.*)\\)",
	"is",
);

/* the shared params (formFieldSetup): question, description, fieldsize, subfield, labelstyle, autofocus; the rest per kind */
function splitParams(params, formDelimiter) {
	const validParams = { question: "..." };
	const restParams = {};
	const set = [];   /* the keys the line gives, as against what a kind fills in by default (the kit's writer reads it) */
	for (let param of params.split(formDelimiter)) {
		param = param.trim();
		if (!param) continue;
		let key, value;
		const equalIndex = param.indexOf("=");
		if (equalIndex !== -1) {
			key = param.slice(0, equalIndex).trim().toLowerCase();
			value = param.slice(equalIndex + 1).trim();
		} else {
			key = param.toLowerCase();
			value = true;
		}
		set.push(key);
		if (key === "question" && value) validParams[key] = value;
		else if (key === "description" && value) validParams[key] = value;
		else if (key === "fieldsize" && value && value === "sm") validParams[key] = value;
		else if (key === "subfield" && value) validParams[key] = value;
		else if (key === "labelstyle" && value && value === "classic") validParams[key] = value;
		else if (key === "autofocus" && value) validParams[key] = value;
		else restParams[key] = value;
	}
	return { validParams, restParams, set };
}

/* "A, B, "b" B, C" → [{ value, label }] — a value in double quotes stands apart from the label */
function splitOptions(value, withImage) {
	const out = [];
	for (let option of value.split(",")) {
		option = unescape(option.trim());
		if (!option) continue;
		let image = "";
		if (withImage) {
			const parts = option.split("&&");
			option = parts[0];
			image = parts.length > 1 ? parts[1] : "";
		}
		let optionValue = option;
		const optionLabel = option.replace(/"\s*(.*?)\s*"/s, function (match, content) { optionValue = content; return ""; });
		const o = { value: optionValue.trim(), label: optionLabel.trim() };
		if (withImage) o.image = image.trim();
		out.push(o);
	}
	return out;
}

function parseFieldLine(text, formDelimiter = "|") {
	const m = String(text || "").match(formFieldPattern);
	if (!m) return null;
	const name = m[1];
	const required = !!m[2];
	const lower = m[3].toLowerCase();
	const [type, kind] = TYPES[lower];
	const raw = m[4].replace(/(<([^>]+)>)/gi, "");   /* HTML tags stripped from the params, as the renderer does */
	const { validParams, restParams, set } = splitParams(raw, formDelimiter);
	const warnings = [];
	const bad = (key, value) => warnings.push(`"${name}": "${key} = ${value}" is not a valid parameter`);

	if (["text", "email", "url", "tel", "password"].includes(kind)) {
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "placeholder" && value && typeof value === "string") validParams[key] = value;
			else if (key === "disabled" && value) validParams[key] = value;
			else if (key === "multiline" && value) validParams[key] = value;
			else if (key === "maxlength" && value && value >>> 0 === parseFloat(value)) validParams[key] = value;
			else if (key === "pattern" && value && typeof value === "string") validParams[key] = value;
			else if (key === "value" && value && typeof value === "string") validParams[key] = value;
			else if (key === "country" && value && typeof value === "string") validParams[key] = value;
			else if (key === "availablecountries" && value && typeof value === "string") validParams[key] = value;
			else bad(key, value);
		}
		if (kind === "tel") {
			validParams.country = validParams.country || "US";
			validParams.placeholder = getPhoneNumberPlaceholder(validParams.country);
			validParams.availablecountries = validParams.availablecountries || "";
			validParams.availablecountries = validParams.availablecountries.trim() === "" ? [] : validParams.availablecountries.split(",");
		}
		if (kind !== "text") delete validParams.multiline;   /* only a text input may be a textarea */
	} else if (kind === "number") {
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "placeholder" && value && typeof value === "string") validParams[key] = value;
			else if (key === "disabled" && value) validParams[key] = value;
			else if (key === "max" && isNumeric(value)) validParams[key] = value;
			else if (key === "min" && isNumeric(value)) validParams[key] = value;
			else if (key === "step" && isNumeric(value)) validParams[key] = value;
			else if (key === "unit" && value && typeof value === "string") validParams[key] = value;
			else if (key === "unitend" && value && typeof value === "string") validParams[key] = value;
			else if (key === "value" && isNumeric(value)) validParams[key] = value;
			else bad(key, value);
		}
	} else if (kind === "select") {
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "placeholder" && value && typeof value === "string") validParams[key] = value;
			else if (key === "disabled" && value) validParams[key] = value;
			else if (key === "options" && value && typeof value === "string") validParams[key] = splitOptions(value, false);
			else if (key === "selected" && value && typeof value === "string") validParams[key] = value;
			else bad(key, value);
		}
		validParams.options = validParams.options || [];
	} else if (kind === "choice" || kind === "picture") {
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "disabled" && value) validParams[key] = value;
			else if (key === "multiple" && value) validParams[key] = value;
			else if (key === "horizontal" && value) validParams[key] = value;
			else if (key === "supersize" && value) validParams[key] = value;
			else if (key === "choices" && value && typeof value === "string") validParams[key] = splitOptions(value, true);
			else if (key === "checked" && value && typeof value === "string") validParams[key] = value.split(",").map((item) => item.trim());
			else if (key === "hidelabels" && value) validParams[key] = value;
			else if (key === "hideformtext" && value) validParams[key] = value;
			else bad(key, value);
		}
		validParams.choices = validParams.choices || [];
		if (!validParams.multiple && Array.isArray(validParams.checked)) validParams.checked.splice(1);   /* one checked value for radio buttons */
	} else if (kind === "rating") {
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "disabled" && value) validParams[key] = value;
			else if (key === "outof" && value && value.match(/^([1-9]|10)$/)) validParams[key] = parseInt(value);
			else if (key === "icon" && value && (value.toLowerCase() === "heart" || value.toLowerCase() === "hearts")) validParams[key] = value.toLowerCase();
			else if (key === "value" && value && typeof value === "string") validParams[key] = parseInt(value);
			else if (key === "hidelabels" && value) validParams[key] = value;
			else bad(key, value);
		}
		validParams.outof = validParams.outof || 5;
		validParams.icon = validParams.icon || "star";
	} else if (kind === "scale") {
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "disabled" && value) validParams[key] = value;
			else if (key === "startat" && value && value.match(/^(0|1)$/)) validParams[key] = parseInt(value);
			else if (key === "outof" && value && value.match(/^([5-9]|10)$/)) validParams[key] = parseInt(value);
			else if (key === "labelstart" && value && typeof value === "string") validParams[key] = value;
			else if (key === "labelend" && value && typeof value === "string") validParams[key] = value;
			else if (key === "hidelabelstart" && value) validParams[key] = value;
			else if (key === "hidelabelend" && value) validParams[key] = value;
			else if (key === "value" && value && typeof value === "string") validParams[key] = parseInt(value);
			else bad(key, value);
		}
		if (validParams.hidelabelstart !== undefined) validParams.labelstart = "";
		if (validParams.hidelabelend !== undefined) validParams.labelend = "";
		if (validParams.startat === undefined) validParams.startat = 0;
		validParams.outof = validParams.outof || 10;
	} else if (kind === "datetime" || kind === "date" || kind === "time") {
		const pattern = kind === "datetime" ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : kind === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{2}:\d{2}$/;
		validParams.placeholder = kind === "datetime" ? "YYYY-MM-DDTHH:mm" : kind === "date" ? "YYYY-MM-DD" : "HH:mm";
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "disabled" && value) validParams[key] = value;
			else if (key === "max" && value && value.match(pattern)) validParams[key] = value;
			else if (key === "min" && value && value.match(pattern)) validParams[key] = value;
			else if (key === "step" && value && typeof value === "string") validParams[key] = value;
			else if (key === "value" && value && value.match(pattern)) validParams[key] = value;
			else bad(key, value);
		}
	} else if (kind === "file") {
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "disabled" && value) validParams[key] = value;
			else if (key === "sizelimit" && isNumeric(value)) validParams[key] = Math.ceil(Math.abs(Number(value)));
			else if (key === "imageonly" && value) validParams[key] = value;
			else if (key === "currentfile" && value && typeof value === "string") { validParams[key] = value; validParams.currentfilename = value.substring(value.lastIndexOf("/") + 1) || value; }
			else bad(key, value);
		}
		validParams.sizelimit = validParams.sizelimit || 10;
	} else if (kind === "voice" || kind === "video") {
		/* THE KIT'S TWO: an answer somebody says rather than types. Both end as a file, so what a
		   recording takes is how long it may run — a minute unless the field says otherwise, because
		   an unbounded recording is a file nobody meant to upload. */
		for (const [key, value] of Object.entries(restParams)) {
			if (key === "disabled" && value) validParams[key] = value;
			else if (key === "maxlength" && isNumeric(value)) validParams[key] = Math.ceil(Math.abs(Number(value)));
			else if (key === "sizelimit" && isNumeric(value)) validParams[key] = Math.ceil(Math.abs(Number(value)));
			else bad(key, value);
		}
		validParams.maxlength = validParams.maxlength || 60;
		validParams.sizelimit = validParams.sizelimit || 25;
	}

	return { name, type, kind, required, params: validParams, set, warnings };
}

export { formFieldPattern, TYPES, parseFieldLine, splitOptions };
