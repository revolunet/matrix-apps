# matrix CMS application prototype

The goal is to create a web frontend for a web application, using matrix protocol as a backend.
All end-to-end encrypted.

The web applications allows :
 - show a list of existing contacts as a table
 - create/edit contacts
 - each contact has a dedicated form

## Models

Each model should have a zod validation schema
Each model instance should have a dedicated channel

### Contacts

Each contact has gender, fullname, email
Each contact has a dedicated comments feed

## Channels

use naming convention ex : `demo-e2e-app/channels/[contact]`

 - One matrix channel for each contact changes
 - One matrix channel for each contact comment feed

## Sharing

 - each user can invite other users in some contact
 - users can work in realtime on the same contact and see changes instantly

## Indexing

Each user stores an index of all its available contacts via a local index
