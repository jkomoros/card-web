declare module 'nodemailer-postmark-transport' {
    export default function postmarkTransport(args: {auth: {apiKey: string}}) : any
}