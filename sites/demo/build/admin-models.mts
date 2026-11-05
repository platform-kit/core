/*
 * THE PRESS'S OWN MODELS of the admin's registry (platformkit.config.js admin.models), in the kit's
 * one shape — here, one: the stockists.
 *
 * A SECTION IS NOT A MODEL. src/stockists/sections.js registers the screen; this registers what the
 * screen saves through. Without it the Stockists page could only write where there is a filesystem,
 * so a cloud-only Northlight — no checkout, content in rows — could see its shops and never change
 * one. The kit's content-kinds check holds exactly that line: a content directory is classified by
 * the model that edits it, and a site's own directory is classified by the site's own model.
 *
 * The export is named `models` because that is the name the registry reads (build/models/index.mjs
 * imports admin.models and takes `.models`); a default export loads and is silently ignored.
 *
 * The step (src/stockists/step.js) compiles these files into .velite/stockists.json for the page.
 * It reads them with fs, which is right: in cloud mode the deploy writes every row out to a file
 * before the build runs, so a build script always meets a checkout. The admin never does.
 */
import { z } from 'zod'

export const models = [
  {
    key: 'stockists',
    name: 'Stockists',
    dir: 'content/stockists',
    title: 'name',
    /* the body is the shop's own line — what it is doing with the books, in the press's voice */
    body: true,
    bodyLabel: 'Note',
    fields: z.object({
      name: z.string().min(1).meta({ label: 'Shop', grid: true }),
      where: z.string().min(1).meta({ label: 'Where', grid: true, help: 'the neighbourhood and city, or "Online, worldwide"' }),
      url: z.string().url().meta({ label: 'Link', grid: true, help: 'where a reader goes to buy from this shop' }),
      published: z.boolean().default(true).meta({ label: 'Published' }),
    }),
  },
]
