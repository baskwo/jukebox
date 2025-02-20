import { BaseCommand } from "../structures/BaseCommand";
import { ColorResolvable, Message, MessageEmbed } from "discord.js";
import { DefineCommand } from "../utils/decorators/DefineCommand";

@DefineCommand({
    aliases: ["pong", "peng", "pingpong"],
    name: "ping",
    description: lang => lang.COMMAND_PING_META_DESCRIPTION(),
    usage: () => "{prefix}ping"
})
export class PingCommand extends BaseCommand {
    public execute(message: Message): Message {
        message.channel.send(this.client.lang.COMMAND_PING_INITIAL_MESSAGE()).then((msg: Message) => {
            const latency = msg.createdTimestamp - message.createdTimestamp;
            const wsLatency = this.client.ws.ping.toFixed(0);
            const embed = new MessageEmbed()
                .setAuthor({ name: this.client.lang.COMMAND_PING_RESULT_MESSAGE(), iconURL: message.client.user?.displayAvatarURL() })
                .setColor(PingCommand.searchHex(wsLatency))
                .addFields({
                    name: this.client.lang.COMMAND_PING_API_LATENCY(),
                    value: `**\`${latency}\`** ms`,
                    inline: true
                }, {
                    name: this.client.lang.COMMAND_PING_WS_LATENCY(),
                    value: `**\`${wsLatency}\`** ms`,
                    inline: true
                })
                .setFooter({ text: this.client.lang.COMMAND_PING_EMBED_FOOTER(message.author.tag), iconURL: message.author.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();

            msg.edit({ content: " ", embeds: [embed] }).catch(e => this.client.logger.error(e));
        }).catch(e => this.client.logger.error(e));
        return message;
    }

    private static searchHex(ms: number | string): ColorResolvable {
        const listColorHex = [
            [0, 20, "#0DFF00"],
            [21, 50, "#0BC700"],
            [51, 100, "#E5ED02"],
            [101, 150, "#FF8C00"],
            [150, 200, "#FF6A00"]
        ];

        const defaultColor = "#FF0D00";

        const min = listColorHex.map(e => e[0]);
        const max = listColorHex.map(e => e[1]);
        const hex = listColorHex.map(e => e[2]);
        let ret: number | string = "#000000";

        for (let i = 0; i < listColorHex.length; i++) {
            if (min[i] <= ms && ms <= max[i]) {
                ret = hex[i];
                break;
            } else {
                ret = defaultColor;
            }
        }
        return ret as ColorResolvable;
    }
}
