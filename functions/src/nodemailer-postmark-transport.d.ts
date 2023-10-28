declare module 'nodemailer-postmark-transport' {
    export default function postmarkTransport(_args: {auth: {apiKey: string}}) : any
}