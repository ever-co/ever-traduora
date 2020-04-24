---
id: cli
title: Cli
sidebar_label: Cli
---

If you like working with thru the terminal you can install `@arelstone/traduota-cli` witch makes it a breeze to create a add a locale, add a term and translate the term to desired locale.

## Installation
In your terminal run the following code:
```bash
npm install -g @arelstone/traduora-cli -save-dev
```

## .tradourarc
Create a file in the root of your project called `.tradourarc` and give it the following data 

Read more about the .tradourarc file in [the documentation](https://arelstone.github.io/traduora-cli/#/?id=traduorarc)

```
{
    baseUrl: '', // Path to the api. Remeber the api/v1 suffix
    username: '', // The username of who will be authendicated
    password: '', // The password
    projectId: '', // The project is for your traduora project
}
```

## Documentation
For a full list of avalible commands and the documentation visit [the documentation page](https://arelstone.github.io/traduora-cli)

### Add a locale 
To add a new locale to the project you have in your rc-file run the following code in your terminal `traduora language:add <CODE>`

```
traduora language:add <CODE>
traduora language:add en_GB
```

### Add a term
To add a term to your project run
```
traduora term:add <TERM>
traduora term:add email_required_validation_error
```

### Translate a term
Now you've added a locale and a term and ofcourse this should be translated. To do this simply just run
```
traduora translate <VALUE> -c=<CODE> -t=<TERM>
traduora translate "E-mail input is required" -c=en_GB -t=email_required_validation_error
```

## Help
To list all avalible commands or get help you can use `help` or the `-h flag`
```
tradoura help
traduora term:add --help
```

