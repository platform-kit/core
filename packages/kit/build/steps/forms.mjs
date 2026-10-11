/* The forms compiled beside the functions — the contract the form function checks a slide against, and what the
   Forms API says about each form (build/forms.mjs); the admin runs the same script on every save */
export default {
  key: 'forms', title: 'The forms', phase: 'functions', module: 'forms', after: ['catalog'],
  inputs: ['content/forms/**'],
  run: ({ script }) => script('forms.mjs'),
}
